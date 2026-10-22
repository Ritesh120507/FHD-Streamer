/**
 * NovaStream - Application Router & UI Coordinator
 */

import { isFirebaseConfigured, getFirebaseConfig, saveFirebaseConfig, clearFirebaseConfig, initFirebase } from './firebase-config.js';
import { setupAuth, signInWithGoogle, logOut, onUserChanged, getCurrentUser } from './auth.js';
import { startStream, stopStream, setStreamerMicMuted, getStreamerMicMuted } from './streamer.js';
import { joinStream, leaveStream, setViewerMicMuted, getViewerMicMuted } from './viewer.js';
import { initChat, sendChatMessage, cleanupChat } from './chat.js';

// DOM Elements
const views = {
  lobby: document.getElementById('lobby-view'),
  studio: document.getElementById('studio-view'),
  viewer: document.getElementById('viewer-view')
};

// Modals & Banners
const configModal = document.getElementById('config-modal');
const toastContainer = document.getElementById('toast-container');
const unmuteBanner = document.getElementById('unmute-banner');

// Auth elements
const authPrompt = document.getElementById('auth-prompt');
const authActions = document.getElementById('auth-actions');
const btnLoginHeader = document.getElementById('btn-login-header');
const btnLoginHero = document.getElementById('btn-login-hero');
const userProfile = document.getElementById('user-profile');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const btnLogout = document.getElementById('btn-logout');

// Lobby elements
const streamOptionsForm = document.getElementById('stream-options-form');
const btnStartStream = document.getElementById('btn-start-stream');
const joinRoomForm = document.getElementById('join-room-form');
const inputRoomCode = document.getElementById('input-room-code');
const btnJoinStream = document.getElementById('btn-join-stream');

// Studio elements
const studioVideo = document.getElementById('studio-video');
const studioRoomCode = document.getElementById('studio-room-code');
const btnCopyRoomCode = document.getElementById('btn-copy-room-code');
const btnCopyShareLink = document.getElementById('btn-copy-share-link');
const btnStopStream = document.getElementById('btn-stop-stream');
const studioViewerStatus = document.getElementById('studio-viewer-status');
const studioViewerCard = document.getElementById('studio-viewer-card');
const studioViewerAvatar = document.getElementById('studio-viewer-avatar');
const studioViewerName = document.getElementById('studio-viewer-name');
const studioViewerEmail = document.getElementById('studio-viewer-email');

// Studio HUD Metrics
const studioMetricFps = document.getElementById('studio-metric-fps');
const studioMetricRes = document.getElementById('studio-metric-res');
const studioMetricBitrate = document.getElementById('studio-metric-bitrate');
const studioMetricRtt = document.getElementById('studio-metric-rtt');

// Viewer elements
const viewerVideo = document.getElementById('viewer-video');
const viewerHostName = document.getElementById('viewer-host-name');
const viewerHostAvatar = document.getElementById('viewer-host-avatar');
const btnLeaveStream = document.getElementById('btn-leave-stream');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnPip = document.getElementById('btn-pip');
const volumeSlider = document.getElementById('volume-slider');

// Viewer HUD Metrics
const viewerMetricFps = document.getElementById('viewer-metric-fps');
const viewerMetricRes = document.getElementById('viewer-metric-res');
const viewerMetricBitrate = document.getElementById('viewer-metric-bitrate');
const viewerMetricRtt = document.getElementById('viewer-metric-rtt');

// Studio Voice & Controls
const streamerVoiceAudio = document.getElementById('streamer-voice-audio');
const btnStreamerMic = document.getElementById('btn-streamer-mic');
const streamerMicOnIcon = document.getElementById('streamer-mic-on-icon');
const streamerMicOffIcon = document.getElementById('streamer-mic-off-icon');
const btnStudioFullscreen = document.getElementById('btn-studio-fullscreen');
const viewerVoiceBadge = document.getElementById('viewer-voice-badge');

// Studio Tabs & Chat
const btnStudioTabChat = document.getElementById('btn-studio-tab-chat');
const btnStudioTabInfo = document.getElementById('btn-studio-tab-info');
const studioPaneChat = document.getElementById('studio-pane-chat');
const studioPaneInfo = document.getElementById('studio-pane-info');
const studioChatMessages = document.getElementById('studio-chat-messages');
const studioChatForm = document.getElementById('studio-chat-form');
const studioChatInput = document.getElementById('studio-chat-input');
const studioChatUnread = document.getElementById('studio-chat-unread');

// Viewer Voice Controls
const btnViewerMic = document.getElementById('btn-viewer-mic');
const viewerMicOnIcon = document.getElementById('viewer-mic-on-icon');
const viewerMicOffIcon = document.getElementById('viewer-mic-off-icon');

// Viewer Tabs & Chat
const btnViewerTabChat = document.getElementById('btn-viewer-tab-chat');
const btnViewerTabInfo = document.getElementById('btn-viewer-tab-info');
const viewerPaneChat = document.getElementById('viewer-pane-chat');
const viewerPaneInfo = document.getElementById('viewer-pane-info');
const viewerChatMessages = document.getElementById('viewer-chat-messages');
const viewerChatForm = document.getElementById('viewer-chat-form');
const viewerChatInput = document.getElementById('viewer-chat-input');
const viewerChatUnread = document.getElementById('viewer-chat-unread');

// Current View Tracker
let currentView = 'lobby';

/**
 * Switch active UI view
 */
function switchView(viewName) {
  Object.keys(views).forEach(key => {
    if (views[key]) {
      views[key].classList.toggle('active', key === viewName);
    }
  });
  currentView = viewName;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Escape HTML to prevent XSS in chat messages
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format timestamp into HH:MM A string
 */
function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Render real-time chat messages into container
 */
function renderChatMessages(container, messages, unreadDot, isPaneActive) {
  if (!container) return;
  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="chat-empty-state">No messages yet. Say hello!</div>';
    return;
  }

  const currentUser = getCurrentUser();
  const currentUid = currentUser ? currentUser.uid : '';

  container.innerHTML = messages.map(msg => {
    const isMe = msg.senderUid === currentUid;
    const avatar = msg.senderPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(msg.senderName || 'U')}`;
    const hostBadge = msg.isHost ? '<span class="chat-badge-host">HOST</span>' : '';
    const time = formatTime(msg.timestamp);

    return `
      <div class="chat-message-item ${isMe ? 'is-me' : ''}">
        <img class="chat-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(msg.senderName)}">
        <div class="chat-content">
          <div class="chat-meta">
            <span class="chat-author">${escapeHtml(msg.senderName)}</span>
            ${hostBadge}
            <span class="chat-time">${time}</span>
          </div>
          <div class="chat-bubble">${escapeHtml(msg.text)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Auto-scroll to latest message
  container.scrollTop = container.scrollHeight;

  // Show unread indicator if user is looking at other tab
  if (!isPaneActive && unreadDot) {
    unreadDot.style.display = 'block';
  }
}

/**
 * Setup side panel tab switcher
 */
function setupPanelTabs(tabChat, tabInfo, paneChat, paneInfo, unreadDot) {
  if (!tabChat || !tabInfo || !paneChat || !paneInfo) return;

  tabChat.addEventListener('click', () => {
    tabChat.classList.add('active');
    tabInfo.classList.remove('active');
    paneChat.classList.add('active');
    paneInfo.classList.remove('active');
    if (unreadDot) unreadDot.style.display = 'none';
  });

  tabInfo.addEventListener('click', () => {
    tabInfo.classList.add('active');
    tabChat.classList.remove('active');
    paneInfo.classList.add('active');
    paneChat.classList.remove('active');
  });
}

/**
 * Toast Notifications
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

/**
 * Copy text helper
 */
async function copyToClipboard(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, 'success');
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast(successMsg, 'success');
  }
}

/**
 * Update UI for authenticated user state
 */
function updateUserUI(user) {
  if (user) {
    if (authPrompt) authPrompt.style.display = 'none';
    if (authActions) authActions.style.display = 'flex';
    if (userProfile) userProfile.style.display = 'flex';
    if (userAvatar) userAvatar.src = user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.displayName || 'U')}`;
    if (userName) userName.textContent = user.displayName || user.email;
    if (btnLoginHeader) btnLoginHeader.style.display = 'none';
  } else {
    if (authPrompt) authPrompt.style.display = 'block';
    if (authActions) authActions.style.display = 'none';
    if (userProfile) userProfile.style.display = 'none';
    if (btnLoginHeader) btnLoginHeader.style.display = 'inline-flex';
  }
}

/**
 * Initialize event handlers and application workflow
 */
function initializeAppWorkflow() {
  // 1. Initialize Firebase Auth
  setupAuth();

  // 2. Auth State Listener
  onUserChanged((user) => {
    updateUserUI(user);
    // If URL has ?room=... auto-join when user is authenticated
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam && user && currentView === 'lobby') {
      inputRoomCode.value = roomParam;
      handleJoinStream(roomParam);
    }
  });

  // 3. Login & Logout buttons
  const triggerLogin = async () => {
    if (!isFirebaseConfigured()) {
      showToast("Firebase credentials not found. Please ensure .env is configured.", "warning", 6000);
      return;
    }
    try {
      showToast("Opening Google Sign-In...", "info");
      await signInWithGoogle();
      showToast("Signed in successfully!", "success");
    } catch (err) {
      showToast(err.message, "error", 6000);
    }
  };

  if (btnLoginHeader) btnLoginHeader.addEventListener('click', triggerLogin);
  if (btnLoginHero) btnLoginHero.addEventListener('click', triggerLogin);

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (currentView === 'studio') await handleStopStream();
      if (currentView === 'viewer') handleLeaveStream();
      await logOut();
      showToast("Signed out", "info");
    });
  }

  // Auto-tune recommended bitrate when resolution changes
  const optResolution = document.getElementById('opt-resolution');
  const optBitrate = document.getElementById('opt-bitrate');
  if (optResolution && optBitrate) {
    optResolution.addEventListener('change', () => {
      const res = optResolution.value;
      if (res === '4k') optBitrate.value = '25';
      else if (res === '1440p') optBitrate.value = '18';
      else if (res === '1080p') optBitrate.value = '10';
      else if (res === '720p') optBitrate.value = '5';
    });
  }

  // 4. Start Streaming (Streamer Flow)
  if (btnStartStream) {
    btnStartStream.addEventListener('click', async () => {
      const user = getCurrentUser();
      if (!user) {
        showToast("Please sign in with Google first to start streaming.", "warning");
        triggerLogin();
        return;
      }

      const resolution = document.getElementById('opt-resolution').value;
      const frameRate = parseInt(document.getElementById('opt-framerate').value, 10);
      const bitrateMbps = parseInt(document.getElementById('opt-bitrate').value, 10);
      const includeMic = document.getElementById('opt-include-mic').checked;

      try {
        btnStartStream.disabled = true;
        btnStartStream.textContent = "Requesting Screen Access...";

        const result = await startStream(
          { resolution, frameRate, bitrateMbps, includeMic },
          {
            onStreamReady: ({ roomId, stream, settings }) => {
              studioVideo.srcObject = stream;
              studioVideo.play().catch(e => console.warn("Local play error:", e));
              studioRoomCode.textContent = roomId;
              studioViewerStatus.textContent = "Waiting for viewer to connect...";
              studioViewerCard.style.display = 'none';

              // Initialize Live Chat for Streamer
              initChat(roomId, (messages) => {
                renderChatMessages(studioChatMessages, messages, studioChatUnread, studioPaneChat && studioPaneChat.classList.contains('active'));
              });

              switchView('studio');
              showToast(`Stream Live! ${resolution.toUpperCase()} @ ${frameRate} FPS (${bitrateMbps} Mbps)`, "success");
            },
            onViewerConnected: (viewer) => {
              showToast(`${viewer.displayName || 'Viewer'} joined the stream!`, "success");
              studioViewerStatus.textContent = "Viewer Connected:";
              studioViewerCard.style.display = 'flex';
              studioViewerName.textContent = viewer.displayName || 'Anonymous Viewer';
              studioViewerEmail.textContent = viewer.email || '';
              studioViewerAvatar.src = viewer.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(viewer.displayName || 'V')}`;
            },
            onViewerVoiceReceived: (voiceStream) => {
              console.log("[NovaStream] Playing incoming viewer voice in Studio");
              if (streamerVoiceAudio) {
                streamerVoiceAudio.srcObject = voiceStream;
                streamerVoiceAudio.play().catch(e => console.warn("Voice play error:", e));
              }
              if (viewerVoiceBadge) viewerVoiceBadge.style.display = 'inline-flex';
              showToast("Viewer Voice Chat Connected 🎙️", "info");
            },
            onViewerDisconnected: () => {
              showToast("Viewer disconnected.", "warning");
              studioViewerStatus.textContent = "Viewer disconnected. Waiting for reconnection...";
              studioViewerCard.style.display = 'none';
            },
            onStatsUpdate: (stats) => {
              if (studioMetricFps) studioMetricFps.textContent = `${stats.fps} FPS`;
              if (studioMetricRes) studioMetricRes.textContent = stats.resolution;
              if (studioMetricBitrate) studioMetricBitrate.textContent = `${stats.bitrateMbps} Mbps`;
              if (studioMetricRtt) studioMetricRtt.textContent = stats.rtt;
            },
            onError: (err) => {
              showToast(`Stream Error: ${err.message}`, "error");
            }
          }
        );
      } catch (err) {
        showToast(err.message || "Failed to start stream", "error");
      } finally {
        btnStartStream.disabled = false;
        btnStartStream.textContent = "Start 4K / 60FPS Stream";
      }
    });
  }

  // 5. Stop Streaming
  async function handleStopStream() {
    cleanupChat();
    await stopStream();
    if (studioVideo.srcObject) {
      studioVideo.srcObject.getTracks().forEach(t => t.stop());
      studioVideo.srcObject = null;
    }
    if (streamerVoiceAudio) {
      streamerVoiceAudio.srcObject = null;
    }
    if (studioChatMessages) {
      studioChatMessages.innerHTML = '<div class="chat-empty-state">Stream ended.</div>';
    }
    switchView('lobby');
    showToast("Stream ended.", "info");
  }
  if (btnStopStream) btnStopStream.addEventListener('click', handleStopStream);

  // 6. Join Stream (Viewer Flow)
  async function handleJoinStream(roomId) {
    const user = getCurrentUser();
    if (!user) {
      showToast("Please sign in with Google to watch.", "warning");
      triggerLogin();
      return;
    }

    if (!roomId) {
      showToast("Please enter a valid 6-character room code.", "warning");
      return;
    }

    try {
      btnJoinStream.disabled = true;
      btnJoinStream.textContent = "Connecting...";

      await joinStream(roomId, {
        onHostDetails: (host, settings) => {
          if (viewerHostName) viewerHostName.textContent = `${host.displayName || 'Host'}'s Stream`;
          if (viewerHostAvatar) viewerHostAvatar.src = host.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(host.displayName || 'H')}`;
        },
        onStreamTrackReceived: (stream) => {
          viewerVideo.srcObject = stream;
          if ('jitterBufferTarget' in viewerVideo) {
            viewerVideo.jitterBufferTarget = 0;
          }
          // Attempt autoplay
          viewerVideo.play().then(() => {
            unmuteBanner.style.display = 'none';
          }).catch(err => {
            // Autoplay with audio restricted by browser policy; prompt user
            console.log("Audio autoplay restricted. Showing unmute banner:", err);
            unmuteBanner.style.display = 'flex';
          });

          switchView('viewer');
          showToast("Connected! Ultra-Low-Latency 60FPS Stream Active", "success");

          // Initialize Live Chat for Viewer
          initChat(roomId, (messages) => {
            renderChatMessages(viewerChatMessages, messages, viewerChatUnread, viewerPaneChat && viewerPaneChat.classList.contains('active'));
          });
        },
        onStatsUpdate: (stats) => {
          if (viewerMetricFps) viewerMetricFps.textContent = `${stats.fps} FPS`;
          if (viewerMetricRes) viewerMetricRes.textContent = stats.resolution;
          if (viewerMetricBitrate) viewerMetricBitrate.textContent = `${stats.bitrateMbps} Mbps`;
          if (viewerMetricRtt) viewerMetricRtt.textContent = stats.rtt;
        },
        onStreamEnded: () => {
          showToast("The host has ended this stream.", "warning");
          handleLeaveStream();
        },
        onError: (err) => {
          showToast(err.message, "error");
        }
      });
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btnJoinStream.disabled = false;
      btnJoinStream.textContent = "Join Stream";
    }
  }

  if (joinRoomForm) {
    joinRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleJoinStream(inputRoomCode.value);
    });
  }

  // 7. Leave Stream
  function handleLeaveStream() {
    cleanupChat();
    leaveStream();
    if (viewerVideo.srcObject) {
      viewerVideo.srcObject.getTracks().forEach(t => t.stop());
      viewerVideo.srcObject = null;
    }
    if (viewerChatMessages) {
      viewerChatMessages.innerHTML = '<div class="chat-empty-state">Stream ended.</div>';
    }
    // Remove query param from URL without page reload
    window.history.replaceState({}, document.title, window.location.pathname);
    switchView('lobby');
  }
  if (btnLeaveStream) btnLeaveStream.addEventListener('click', handleLeaveStream);

  // 8. Unmute Banner Action
  if (unmuteBanner) {
    unmuteBanner.addEventListener('click', () => {
      viewerVideo.muted = false;
      viewerVideo.play().then(() => {
        unmuteBanner.style.display = 'none';
        showToast("Audio active", "info");
      });
    });
  }

  // 9. Fullscreen & PiP controls
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      const container = document.getElementById('viewer-stage');
      if (!document.fullscreenElement) {
        if (container.requestFullscreen) container.requestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }

  if (btnPip) {
    btnPip.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (viewerVideo.requestPictureInPicture) {
          await viewerVideo.requestPictureInPicture();
        }
      } catch (e) {
        showToast("Picture-in-picture error: " + e.message, "error");
      }
    });
  }

  // 10. Volume slider
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      viewerVideo.volume = parseFloat(e.target.value);
      viewerVideo.muted = viewerVideo.volume === 0;
    });
  }

  // 11. Copy Room Code & Share Link
  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener('click', () => {
      const code = studioRoomCode.textContent;
      copyToClipboard(code, `Room Code ${code} copied!`);
    });
  }

  if (btnCopyShareLink) {
    btnCopyShareLink.addEventListener('click', () => {
      const code = studioRoomCode.textContent;
      const shareUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
      copyToClipboard(shareUrl, "Shareable stream link copied to clipboard!");
    });
  }

  // 12. Panel Tab Switching (Live Chat vs Info)
  setupPanelTabs(btnStudioTabChat, btnStudioTabInfo, studioPaneChat, studioPaneInfo, studioChatUnread);
  setupPanelTabs(btnViewerTabChat, btnViewerTabInfo, viewerPaneChat, viewerPaneInfo, viewerChatUnread);

  // 14. Chat Message Submission
  if (studioChatForm) {
    studioChatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = studioChatInput.value;
      if (!text.trim()) return;
      studioChatInput.value = '';
      try {
        await sendChatMessage(text, true); // Host message
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  if (viewerChatForm) {
    viewerChatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = viewerChatInput.value;
      if (!text.trim()) return;
      viewerChatInput.value = '';
      try {
        await sendChatMessage(text, false); // Viewer message
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // 15. Viewer Microphone Mute / Unmute Toggle (Two-Way Voice Chat)
  if (btnViewerMic) {
    btnViewerMic.addEventListener('click', () => {
      const isMuted = !getViewerMicMuted();
      setViewerMicMuted(isMuted);
      btnViewerMic.classList.toggle('mic-muted', isMuted);
      btnViewerMic.classList.toggle('mic-unmuted', !isMuted);
      if (viewerMicOnIcon) viewerMicOnIcon.style.display = isMuted ? 'none' : 'block';
      if (viewerMicOffIcon) viewerMicOffIcon.style.display = isMuted ? 'block' : 'none';
      showToast(isMuted ? "Your Microphone is Muted 🔴" : "Microphone Active 🟢 (Streamer can hear you!)", isMuted ? "warning" : "success");
    });
  }

  // 16. Streamer Microphone Mute / Unmute Toggle
  if (btnStreamerMic) {
    btnStreamerMic.addEventListener('click', () => {
      const isMuted = !getStreamerMicMuted();
      setStreamerMicMuted(isMuted);
      btnStreamerMic.classList.toggle('mic-muted', isMuted);
      btnStreamerMic.classList.toggle('mic-unmuted', !isMuted);
      if (streamerMicOnIcon) streamerMicOnIcon.style.display = isMuted ? 'none' : 'block';
      if (streamerMicOffIcon) streamerMicOffIcon.style.display = isMuted ? 'block' : 'none';
      showToast(isMuted ? "Host Mic Muted 🔴" : "Host Mic Active 🟢", isMuted ? "warning" : "success");
    });
  }

  // 17. Studio Fullscreen Monitor
  if (btnStudioFullscreen) {
    btnStudioFullscreen.addEventListener('click', () => {
      const stage = studioVideo.closest('.video-stage');
      if (!document.fullscreenElement) {
        if (stage && stage.requestFullscreen) stage.requestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }
}

// Auto-start on DOM Ready
document.addEventListener('DOMContentLoaded', initializeAppWorkflow);

