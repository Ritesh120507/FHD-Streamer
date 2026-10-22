/**
 * NovaStream - Viewer Controller Module
 * Handles WebRTC client reception, 1080p60 playback, low-latency audio & Firestore signaling
 */

import { doc, getDoc, updateDoc, onSnapshot, collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initFirebase } from './firebase-config.js';
import { getCurrentUser } from './auth.js';
import { RTC_CONFIG, startStatsMonitor, prioritize4KCodecs, captureViewerMicrophone, enhanceSDP } from './webrtc.js';

let peerConnection = null;
let currentRoomId = null;
let remoteStream = null;
let viewerMicStream = null;
let viewerMicSender = null;
let isViewerMicMuted = false;
let stopStatsMonitor = null;
let roomUnsubscribe = null;
let candidatesUnsubscribe = null;

/**
 * Join an active stream room
 */
export async function joinStream(roomId, callbacks = {}) {
  const user = getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in with Google to watch streams.");
  }

  const { db } = initFirebase();
  if (!db) {
    throw new Error("Firebase database is not initialized.");
  }

  const normalizedRoomId = roomId.trim().toUpperCase();
  currentRoomId = normalizedRoomId;

  const {
    onStreamTrackReceived,
    onHostDetails,
    onStatsUpdate,
    onStreamEnded,
    onError
  } = callbacks;

  try {
    const roomRef = doc(db, 'rooms', normalizedRoomId);
    const roomSnapshot = await getDoc(roomRef);

    if (!roomSnapshot.exists()) {
      throw new Error(`Stream Room "${normalizedRoomId}" does not exist. Please verify the room code.`);
    }

    const roomData = roomSnapshot.data();
    if (roomData.status === 'ended') {
      throw new Error("This stream has already ended.");
    }

    if (!roomData.offer) {
      throw new Error("Stream is not ready yet. Please wait a moment and try again.");
    }

    if (onHostDetails) {
      onHostDetails(roomData.host, roomData.settings);
    }

    // 1. Create PeerConnection
    peerConnection = new RTCPeerConnection(RTC_CONFIG);
    prioritize4KCodecs(peerConnection);
    remoteStream = new MediaStream();

    let remoteDescriptionSet = false;
    const pendingCandidates = [];

    // 2. Handle incoming video and audio tracks
    peerConnection.ontrack = (event) => {
      console.log("[NovaStream] Received remote track:", event.track.kind);
      event.streams[0].getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some(t => t.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });

      if (onStreamTrackReceived) {
        onStreamTrackReceived(remoteStream);
      }
    };

    // 3. Collect Viewer ICE candidates and write to Firestore
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(calleeCandidatesCollection, event.candidate.toJSON()).catch(e => {
          console.warn("[NovaStream] Error sending callee ICE candidate:", e);
        });
      }
    };

    // Connection state
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log("[NovaStream] Viewer connection state:", state);
      if (state === 'failed') {
        console.warn("[NovaStream] Direct P2P connection to host failed.");
        if (onError) onError(new Error("Unable to establish direct P2P connection to streamer. Check network or firewall."));
      }
    };

    // 4. Set Host Offer as Remote Description
    const offerDescription = new RTCSessionDescription(roomData.offer);
    await peerConnection.setRemoteDescription(offerDescription);
    remoteDescriptionSet = true;

    // Drain any caller ICE candidates that arrived before Offer was processed
    for (const cand of pendingCandidates) {
      try {
        await peerConnection.addIceCandidate(cand);
      } catch (e) {
        console.warn("[NovaStream] Error adding queued caller ICE candidate:", e);
      }
    }
    pendingCandidates.length = 0;

    // 4b. Enable Viewer Voice: Capture viewer microphone for 2-way talk
    try {
      viewerMicStream = await captureViewerMicrophone();
      if (viewerMicStream) {
        const micTrack = viewerMicStream.getAudioTracks()[0];
        if (micTrack) {
          viewerMicSender = peerConnection.addTrack(micTrack, viewerMicStream);
          micTrack.enabled = !isViewerMicMuted;
          console.log("[NovaStream] Added viewer voice track to PeerConnection (muted: " + isViewerMicMuted + ")");
        }
      }
    } catch (e) {
      console.warn("[NovaStream] Viewer mic capture failed or permission denied:", e);
    }

    // 5. Create Answer & enhance with high bitrate SDP to prevent receiver throttling
    const answer = await peerConnection.createAnswer();
    const targetBitrateKbps = (roomData.settings?.bitrateMbps || 25) * 1000;
    const enhancedAnswerSdp = enhanceSDP(answer.sdp, targetBitrateKbps);
    const answerDescription = new RTCSessionDescription({ type: answer.type, sdp: enhancedAnswerSdp });
    await peerConnection.setLocalDescription(answerDescription);

    // 6. Update Firestore with Answer & Viewer Info
    await updateDoc(roomRef, {
      status: 'active',
      answer: {
        type: answerDescription.type,
        sdp: answerDescription.sdp
      },
      viewer: {
        uid: user.uid,
        displayName: user.displayName || 'Viewer',
        email: user.email,
        photoURL: user.photoURL || ''
      }
    });

    // 7. Listen for Host's ICE candidates (with queueing if needed)
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    candidatesUnsubscribe = onSnapshot(callerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const candidateData = change.doc.data();
          const candidate = new RTCIceCandidate(candidateData);
          if (remoteDescriptionSet && peerConnection.currentRemoteDescription) {
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (e) {
              console.warn("[NovaStream] Error adding caller ICE candidate:", e);
            }
          } else {
            pendingCandidates.push(candidate);
          }
        }
      });
    });

    // 8. Listen for Room Status changes (only trigger if streamer explicitly ends)
    roomUnsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data && data.status === 'ended') {
          console.log("[NovaStream] Host formally ended the stream.");
          if (onStreamEnded) onStreamEnded();
          leaveStream();
        }
      }
    });

    // 9. Start live telemetry HUD stats monitor
    if (onStatsUpdate) {
      stopStatsMonitor = startStatsMonitor(peerConnection, onStatsUpdate, 1000);
    }

    return {
      roomId: normalizedRoomId,
      remoteStream
    };
  } catch (error) {
    console.error("[NovaStream] Viewer join failed:", error);
    leaveStream();
    if (onError) onError(error);
    throw error;
  }
}

/**
 * Leave the current stream room and disconnect WebRTC
 */
export function leaveStream() {
  if (stopStatsMonitor) {
    stopStatsMonitor();
    stopStatsMonitor = null;
  }

  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }

  if (candidatesUnsubscribe) {
    candidatesUnsubscribe();
    candidatesUnsubscribe = null;
  }

  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {}
    peerConnection = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }

  if (viewerMicStream) {
    viewerMicStream.getTracks().forEach(track => track.stop());
    viewerMicStream = null;
  }
  viewerMicSender = null;

  currentRoomId = null;
}

export function getRemoteStream() {
  return remoteStream;
}

/**
 * Mute or unmute viewer microphone during voice chat
 */
export function setViewerMicMuted(muted) {
  isViewerMicMuted = Boolean(muted);
  if (viewerMicStream) {
    viewerMicStream.getAudioTracks().forEach(track => {
      track.enabled = !isViewerMicMuted;
    });
  }
  return isViewerMicMuted;
}

export function getViewerMicMuted() {
  return isViewerMicMuted;
}

export function hasViewerMic() {
  return Boolean(viewerMicStream && viewerMicStream.getAudioTracks().length > 0);
}

