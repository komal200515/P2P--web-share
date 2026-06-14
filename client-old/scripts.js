/* ================================================================
   P2P Share — scripts.js
   Handles: socket signaling, WebRTC, file chunking, SHA-256, UI
   ================================================================ */

const CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ── State ──────────────────────────────────────────────────────
let socket, pc, dataChannel;
let selectedFile = null;
let currentRoomId = null;
let isSender = false;

// Receiver buffering
let receivedChunks = [];
let totalChunks = 0;
let receivedCount = 0;
let incomingMeta = null;

// Speed tracking
let bytesTransferred = 0;
let lastSpeedBytes = 0;
let lastSpeedTime = Date.now();
let speedInterval = null;
let transferStartTime = null;

// ── Socket connection ──────────────────────────────────────────
function connectSocket() {
  socket = io();

  socket.on('room-created', ({ roomId }) => {
    currentRoomId = roomId;
    document.getElementById('display-room-id').textContent = roomId;
    showView('view-sender');
  });

  socket.on('join-success', ({ roomId }) => {
    currentRoomId = roomId;
    showView('view-receiver');
    setReceiverStatus('connecting', 'Establishing connection…');
    startReceiverConnection();
  });

  socket.on('join-error', ({ message }) => {
    const el = document.getElementById('join-error');
    document.getElementById('join-error-msg').textContent = message;
    el.style.display = 'flex';
  });

  socket.on('receiver-joined', () => {
    setSenderStatus('active', 'Receiver connected — starting transfer…');
    startSenderConnection();
  });

  socket.on('offer', ({ offer }) => handleOffer(offer));
  socket.on('answer', ({ answer }) => handleAnswer(answer));
  socket.on('ice-candidate', ({ candidate }) => handleIceCandidate(candidate));

  socket.on('transfer-done', () => {
    document.getElementById('sender-done').style.display = 'flex';
    setSenderStatus('active', 'Transfer complete');
    stopSpeedTimer();
  });

  socket.on('peer-disconnected', () => {
    showDisconnect();
  });
}

// ── View management ────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('tab-content-' + tab).classList.add('active');
  document.getElementById('join-error').style.display = 'none';
}

function resetApp() {
  if (pc) { pc.close(); pc = null; }
  if (dataChannel) { dataChannel = null; }
  if (socket) { socket.disconnect(); socket = null; }
  stopSpeedTimer();
  selectedFile = null;
  currentRoomId = null;
  isSender = false;
  receivedChunks = [];
  totalChunks = 0;
  receivedCount = 0;
  bytesTransferred = 0;
  incomingMeta = null;

  document.getElementById('file-input').value = '';
  document.getElementById('file-preview').style.display = 'none';
  document.getElementById('btn-share').disabled = true;
  document.getElementById('sender-progress').style.display = 'none';
  document.getElementById('sender-hash-section').style.display = 'none';
  document.getElementById('sender-done').style.display = 'none';
  document.getElementById('receiver-progress').style.display = 'none';
  document.getElementById('receiver-hash-section').style.display = 'none';
  document.getElementById('receiver-verify').style.display = 'none';
  document.getElementById('receiver-verify-fail').style.display = 'none';
  document.getElementById('room-input').value = '';
  document.getElementById('join-error').style.display = 'none';
  document.getElementById('sender-chat-box').innerHTML = '';
  document.getElementById('receiver-chat-box').innerHTML = '';
  setSenderStatus('waiting', 'Waiting for someone to join…');
  setReceiverStatus('connecting', 'Establishing connection…');
  showView('view-home');
  connectSocket();
}

// ── File selection ─────────────────────────────────────────────
function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  // FIX: clicking the zone triggers the file picker
  zone.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    if (input.files[0]) selectFile(input.files[0]);
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  });
}

function selectFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    alert(`File too large. Maximum size is ${formatSize(MAX_FILE_SIZE)}.`);
    return;
  }
  selectedFile = file;
  document.getElementById('preview-name').textContent = file.name;
  document.getElementById('preview-meta').textContent =
    `${formatSize(file.size)} · ${file.type || 'Unknown type'}`;
  document.getElementById('file-preview').style.display = 'flex';
  document.getElementById('btn-share').disabled = false;
}

// ── Room actions ───────────────────────────────────────────────
function createRoom() {
  if (!selectedFile) return;
  socket.emit('create-room');
}

function joinRoom() {
  const code = document.getElementById('room-input').value.trim().toUpperCase();
  if (code.length !== 8) {
    document.getElementById('join-error-msg').textContent = 'Room code must be 8 characters.';
    document.getElementById('join-error').style.display = 'flex';
    return;
  }
  document.getElementById('join-error').style.display = 'none';
  socket.emit('join-room', { roomId: code });
}

function copyRoomId() {
  navigator.clipboard.writeText(currentRoomId).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

// ── WebRTC — Sender side ───────────────────────────────────────
function startSenderConnection() {
  isSender = true;
  pc = new RTCPeerConnection(STUN);

  dataChannel = pc.createDataChannel('file-transfer', {
    ordered: true,
    maxRetransmits: 30,
  });
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    setSenderStatus('active', 'Connected — sending file…');
    sendFile();
  };

  dataChannel.onmessage = handleIncomingMessage; // FIX: sender also receives chat

  dataChannel.onclose = () => showDisconnect();
  dataChannel.onerror = () => showDisconnect();

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { roomId: currentRoomId, candidate });
  };

  pc.oniceconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
      showDisconnect();
    }
  };

  pc.createOffer().then(offer => {
    pc.setLocalDescription(offer);
    socket.emit('offer', { roomId: currentRoomId, offer });
  });
}

async function handleAnswer(answer) {
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

// ── WebRTC — Receiver side ─────────────────────────────────────
function startReceiverConnection() {
  isSender = false;
  pc = new RTCPeerConnection(STUN);

  pc.ondatachannel = ({ channel }) => {
    dataChannel = channel;
    dataChannel.binaryType = 'arraybuffer';
    dataChannel.onmessage = handleIncomingMessage;
    dataChannel.onclose = () => showDisconnect();
    dataChannel.onerror = () => showDisconnect();
    setReceiverStatus('active', 'Connected — receiving file…');
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { roomId: currentRoomId, candidate });
  };

  pc.oniceconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
      showDisconnect();
    }
  };
}

async function handleOffer(offer) {
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { roomId: currentRoomId, answer });
}

async function handleIceCandidate(candidate) {
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    // ignore stale candidates
  }
}

// ── File sending ───────────────────────────────────────────────
async function sendFile() {
  const file = selectedFile;
  const totalSize = file.size;
  const chunks = Math.ceil(totalSize / CHUNK_SIZE);

  // Compute whole-file SHA-256
  const fileBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
  const fileHash = bufferToHex(hashBuffer);

  // Show sender hash
  document.getElementById('sender-hash-display').textContent = fileHash;
  document.getElementById('sender-hash-section').style.display = 'block';

  // Send metadata first
  const meta = JSON.stringify({
    type: 'meta',
    name: file.name,
    size: totalSize,
    chunks,
    hash: fileHash,
  });
  dataChannel.send(meta);

  // Show progress UI
  document.getElementById('sender-progress').style.display = 'flex';
  startSpeedTimer('sender');
  transferStartTime = Date.now();

  // Stream chunks
  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SIZE;
    const slice = fileBuffer.slice(start, start + CHUNK_SIZE);

    // Wait if buffer is too full (backpressure)
    while (dataChannel.bufferedAmount > 5 * 1024 * 1024) {
      await sleep(20);
    }

    dataChannel.send(slice);

    // FIX: don't overcount — last chunk may be smaller
    bytesTransferred = Math.min((i + 1) * CHUNK_SIZE, totalSize);
    updateSenderProgress(i + 1, chunks, totalSize);
  }
}

function updateSenderProgress(sent, total, totalSize) {
  const pct = Math.min(100, Math.round((sent / total) * 100));
  document.getElementById('sender-progress-fill').style.width = pct + '%';
  document.getElementById('s-percent').textContent = pct + '%';
  updateEta('s-eta', Math.min(sent * CHUNK_SIZE, totalSize), totalSize);
}

// ── File receiving / message dispatch ─────────────────────────
async function handleIncomingMessage({ data }) {
  // String messages are JSON (meta or chat)
  if (typeof data === 'string') {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }

    if (msg.type === 'chat') {
      // Route chat to the correct box based on who WE are
      const myRole = isSender ? 'sender' : 'receiver';
      appendChat(myRole, msg.text, 'them');
      return;
    }

    if (msg.type === 'meta') {
      incomingMeta = msg;
      totalChunks = msg.chunks;
      receivedChunks = new Array(msg.chunks);
      receivedCount = 0;
      bytesTransferred = 0;

      document.getElementById('incoming-name').textContent = msg.name;
      document.getElementById('incoming-meta').textContent =
        `${formatSize(msg.size)} · ${msg.chunks} chunks`;
      document.getElementById('receiver-progress').style.display = 'flex';
      startSpeedTimer('receiver');
      transferStartTime = Date.now();
      setReceiverStatus('active', 'Receiving…');
    }
    return;
  }

  // Binary chunk
  receivedChunks[receivedCount] = data;
  receivedCount++;

  // FIX: accurate byte count for last chunk
  bytesTransferred = Math.min(receivedCount * CHUNK_SIZE, incomingMeta.size);
  updateReceiverProgress(receivedCount, totalChunks, incomingMeta.size);

  if (receivedCount === totalChunks) {
    stopSpeedTimer();
    await assembleAndVerify();
  }
}

function updateReceiverProgress(received, total, totalSize) {
  const pct = Math.min(100, Math.round((received / total) * 100));
  document.getElementById('receiver-progress-fill').style.width = pct + '%';
  document.getElementById('r-percent').textContent = pct + '%';
  updateEta('r-eta', Math.min(received * CHUNK_SIZE, totalSize), totalSize);
}

async function assembleAndVerify() {
  const blob = new Blob(receivedChunks);
  const buffer = await blob.arrayBuffer();

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const receivedHash = bufferToHex(hashBuffer);

  document.getElementById('receiver-hash-display').textContent = receivedHash;
  document.getElementById('receiver-hash-section').style.display = 'block';

  if (receivedHash === incomingMeta.hash) {
    const url = URL.createObjectURL(new Blob([buffer]));
    const a = document.createElement('a');
    a.href = url;
    a.download = incomingMeta.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    document.getElementById('receiver-verify').style.display = 'flex';
    document.getElementById('receiver-verify-text').textContent =
      'File integrity verified — download started';
    setReceiverStatus('active', 'Transfer complete');

    socket.emit('transfer-done', { roomId: currentRoomId });
  } else {
    document.getElementById('receiver-verify-fail').style.display = 'flex';
    setReceiverStatus('error', 'Hash mismatch — file corrupted');
  }
}

// ── Speed / ETA tracking ───────────────────────────────────────
function startSpeedTimer(role) {
  lastSpeedBytes = 0;
  lastSpeedTime = Date.now();
  stopSpeedTimer();
  speedInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastSpeedTime) / 1000;
    const delta = bytesTransferred - lastSpeedBytes;
    const speed = delta / elapsed;
    lastSpeedBytes = bytesTransferred;
    lastSpeedTime = now;

    const speedStr = speed > 0 ? formatSpeed(speed) : '0 KB/s';
    if (role === 'sender') {
      document.getElementById('s-speed').textContent = speedStr;
    } else {
      document.getElementById('r-speed').textContent = speedStr;
    }
  }, 1000);
}

function stopSpeedTimer() {
  if (speedInterval) { clearInterval(speedInterval); speedInterval = null; }
}

function updateEta(elId, transferred, total) {
  const elapsed = (Date.now() - transferStartTime) / 1000;
  if (elapsed < 1 || transferred === 0) {
    document.getElementById(elId).textContent = '--';
    return;
  }
  const speed = transferred / elapsed;
  const remaining = (total - transferred) / speed;
  document.getElementById(elId).textContent = remaining > 0
    ? formatTime(remaining)
    : 'Done';
}

// ── Status helpers ─────────────────────────────────────────────
function setSenderStatus(type, text) {
  const bar = document.getElementById('sender-status');
  bar.className = 'status-bar status-' + type;
  document.getElementById('sender-status-text').textContent = text;
}

function setReceiverStatus(type, text) {
  const bar = document.getElementById('receiver-status');
  bar.className = 'status-bar status-' + type;
  document.getElementById('receiver-status-text').textContent = text;
}

function showDisconnect() {
  stopSpeedTimer();
  const msg = 'Connection lost — the other peer disconnected.';
  if (isSender) {
    setSenderStatus('error', msg);
  } else {
    setReceiverStatus('error', msg);
  }
}

// ── Utilities ──────────────────────────────────────────────────
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function formatTime(secs) {
  if (secs < 60) return Math.ceil(secs) + 's';
  return Math.floor(secs / 60) + 'm ' + Math.ceil(secs % 60) + 's';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Chat ───────────────────────────────────────────────────────
function sendChat(role) {
  const inputId = role === 'sender' ? 'sender-chat-input' : 'receiver-chat-input';
  const input = document.getElementById(inputId);
  const text = input.value.trim();
  if (!text || !dataChannel || dataChannel.readyState !== 'open') return;

  dataChannel.send(JSON.stringify({ type: 'chat', text }));
  appendChat(role, text, 'me');
  input.value = '';
}

function appendChat(role, text, side) {
  const boxId = role === 'sender' ? 'sender-chat-box' : 'receiver-chat-box';
  const box = document.getElementById(boxId);
  if (!box) return;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msg = document.createElement('div');
  msg.className = `chat-msg ${side}`;
  msg.innerHTML = `${text}<div class="chat-time">${time}</div>`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

// ── Boot ───────────────────────────────────────────────────────
connectSocket();
setupDropZone();