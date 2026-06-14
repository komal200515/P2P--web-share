
// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────
let socket, peerConnection, dataChannel;
let selectedFile = null;
let currentRoomId = null;
let isSender = false;

// Transfer tracking
let transferStartTime = 0;
let bytesTransferred = 0;
let lastSpeedSample = { time: 0, bytes: 0 };

// Receiver reassembly
let receivedChunks = [];
let receivedBytes = 0;
let expectedSize = 0;
let expectedHash = '';
let incomingFileName = '';

// ────────────────────────────────────────────────────────────────────────────
// UI helpers
// ────────────────────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function switchTab(name) {
  ['send','receive'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === name);
    document.getElementById('tab-content-' + t).classList.toggle('active', t === name);
  });
}

function setSenderStatus(type, text) {
  const el = document.getElementById('sender-status');
  el.className = 'status-bar status-' + type;
  document.getElementById('sender-status-text').textContent = text;
}

function setReceiverStatus(type, text) {
  const el = document.getElementById('receiver-status');
  el.className = 'status-bar status-' + type;
  document.getElementById('receiver-status-text').textContent = text;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function formatETA(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return Math.ceil(seconds) + 's';
  return Math.floor(seconds / 60) + 'm ' + Math.ceil(seconds % 60) + 's';
}

function updateProgress(sent, total, idPrefix) {
  const pct = total > 0 ? (sent / total) * 100 : 0;
  document.getElementById(idPrefix + '-progress-fill').style.width = pct.toFixed(1) + '%';
  document.getElementById(idPrefix === 's' ? 's-percent' : 'r-percent').textContent = pct.toFixed(0) + '%';

  const now = Date.now();
  const elapsed = (now - lastSpeedSample.time) / 1000;
  if (elapsed > 0.3) {
    const bytesInWindow = sent - lastSpeedSample.bytes;
    const speed = bytesInWindow / elapsed;
    const remaining = (total - sent) / Math.max(speed, 1);
    document.getElementById(idPrefix === 's' ? 's-speed' : 'r-speed').textContent = formatSpeed(speed);
    document.getElementById(idPrefix === 's' ? 's-eta' : 'r-eta').textContent = formatETA(remaining);
    lastSpeedSample = { time: now, bytes: sent };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// File selection
// ────────────────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files.length) setFile(e.target.files[0]); });

function setFile(file) {
  selectedFile = file;
  document.getElementById('preview-name').textContent = file.name;
  document.getElementById('preview-meta').textContent = formatSize(file.size) + ' — ' + (file.type || 'unknown type');
  document.getElementById('file-preview').style.display = 'flex';
  document.getElementById('btn-share').disabled = false;
}

// ────────────────────────────────────────────────────────────────────────────
// Socket connection
// ────────────────────────────────────────────────────────────────────────────
function connectSocket() {
  if (socket && socket.connected) return;
  socket = io();

  socket.on('connect', () => console.log('[socket] connected', socket.id));

  socket.on('room-created', ({ roomId }) => {
    currentRoomId = roomId;
    document.getElementById('display-room-id').textContent = roomId;
    showView('view-sender');
    setSenderStatus('waiting', 'Waiting for someone to join\u2026');
    computeAndShowSenderHash();
  });

  socket.on('peer-joined', () => {
    setSenderStatus('connecting', 'Peer connected — establishing WebRTC\u2026');
    startSenderRTC();
  });

  socket.on('peer-disconnected', () => {
    if (isSender) setSenderStatus('error', 'Receiver disconnected.');
    else setReceiverStatus('error', 'Sender disconnected.');
    cleanupRTC();
  });

  socket.on('offer', async ({ offer }) => {
    if (isSender) return;
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { roomId: currentRoomId, answer });
  });

  socket.on('answer', async ({ answer }) => {
    if (!isSender) return;
    await peerConnection.setRemoteDescription(answer);
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    try { await peerConnection.addIceCandidate(candidate); } catch(e) {}
  });

  socket.on('room-joined', ({ fileInfo }) => {
    currentRoomId = document.getElementById('room-input').value.trim();
    incomingFileName = fileInfo.name;
    expectedSize = fileInfo.size;
    expectedHash = fileInfo.hash;
    document.getElementById('incoming-name').textContent = fileInfo.name;
    document.getElementById('incoming-meta').textContent = formatSize(fileInfo.size) + ' — ' + (fileInfo.type || 'unknown type');
    showView('view-receiver');
    setReceiverStatus('connecting', 'Establishing connection\u2026');
    startReceiverRTC();
  });

  socket.on('error', ({ message }) => {
    document.getElementById('join-error-msg').textContent = message;
    document.getElementById('join-error').style.display = 'flex';
  });
}

// ────────────────────────────────────────────────────────────────────────────
// SHA-256
// ────────────────────────────────────────────────────────────────────────────
async function sha256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function computeAndShowSenderHash() {
  const buf = await selectedFile.arrayBuffer();
  const hash = await sha256(buf);
  document.getElementById('sender-hash-section').style.display = 'block';
  document.getElementById('sender-hash-display').textContent = hash;
  // Store in fileInfo for receiver to verify
  selectedFile._hash = hash;
}

// ────────────────────────────────────────────────────────────────────────────
// Room creation
// ────────────────────────────────────────────────────────────────────────────
async function createRoom() {
  if (!selectedFile) return;
  isSender = true;
  connectSocket();

  // Compute hash first (needed for fileInfo)
  const buf = await selectedFile.arrayBuffer();
  const hash = await sha256(buf);
  selectedFile._hash = hash;
  selectedFile._buf = buf;

  socket.emit('create-room', {
    fileInfo: {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
      hash
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Join room
// ────────────────────────────────────────────────────────────────────────────
function joinRoom() {
  const roomId = document.getElementById('room-input').value.trim().toUpperCase();
  if (roomId.length !== 8) {
    document.getElementById('join-error-msg').textContent = 'Room code must be 8 characters.';
    document.getElementById('join-error').style.display = 'flex';
    return;
  }
  isSender = false;
  connectSocket();
  socket.emit('join-room', { roomId });
}

// ────────────────────────────────────────────────────────────────────────────
// WebRTC — Sender
// ────────────────────────────────────────────────────────────────────────────
function startSenderRTC() {
  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  peerConnection.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { roomId: currentRoomId, candidate: e.candidate });
  };

  peerConnection.onconnectionstatechange = () => {
    const s = peerConnection.connectionState;
    if (s === 'connected') { setSenderStatus('connected', 'Connected — transferring\u2026'); startSendingFile(); }
    if (s === 'failed' || s === 'disconnected') setSenderStatus('error', 'Connection lost.');
  };

  dataChannel = peerConnection.createDataChannel('file-transfer', {
    ordered: true,
    maxRetransmits: null
  });
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    // connection state change fires separately
  };

  dataChannel.onclose = () => setSenderStatus('error', 'Data channel closed unexpectedly.');

  dataChannel.onmessage = e => {
    // Receive acknowledgement from receiver that hash matched
    if (e.data === 'HASH_OK') {
      document.getElementById('sender-done').style.display = 'flex';
      setSenderStatus('connected', 'Transfer complete!');
    } else if (e.data === 'HASH_FAIL') {
      setSenderStatus('error', 'Receiver reported hash mismatch!');
    }
  };

  // Create offer
  peerConnection.createOffer().then(offer => {
    peerConnection.setLocalDescription(offer);
    socket.emit('offer', { roomId: currentRoomId, offer });
  });
}

async function startSendingFile() {
  const buf = selectedFile._buf || (await selectedFile.arrayBuffer());
  const totalSize = buf.byteLength;

  document.getElementById('sender-progress').style.display = 'block';
  transferStartTime = Date.now();
  lastSpeedSample = { time: Date.now(), bytes: 0 };
  bytesTransferred = 0;

  // Send file metadata first
  const meta = JSON.stringify({ name: selectedFile.name, size: totalSize, type: selectedFile.type, hash: selectedFile._hash });
  dataChannel.send('META:' + meta);

  // Stream chunks
  let offset = 0;
  const BUFFER_HIGH = 4 * 1024 * 1024; // 4 MB buffer threshold

  function sendNextChunk() {
    while (offset < totalSize) {
      if (dataChannel.bufferedAmount > BUFFER_HIGH) {
        // Back off — wait for buffer to drain
        dataChannel.onbufferedamountlow = sendNextChunk;
        dataChannel.bufferedAmountLowThreshold = 512 * 1024;
        return;
      }
      const slice = buf.slice(offset, offset + CHUNK_SIZE);
      dataChannel.send(slice);
      offset += slice.byteLength;
      bytesTransferred = offset;
      updateProgress(offset, totalSize, 's');
    }
    // Done
    dataChannel.send('EOF');
    setSenderStatus('connected', 'Sent — waiting for verification\u2026');
  }

  sendNextChunk();
}

// ────────────────────────────────────────────────────────────────────────────
// WebRTC — Receiver
// ────────────────────────────────────────────────────────────────────────────
function startReceiverRTC() {
  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  peerConnection.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { roomId: currentRoomId, candidate: e.candidate });
  };

  peerConnection.onconnectionstatechange = () => {
    const s = peerConnection.connectionState;
    if (s === 'connected') setReceiverStatus('connected', 'Connected — receiving\u2026');
    if (s === 'failed' || s === 'disconnected') setReceiverStatus('error', 'Connection lost.');
  };

  peerConnection.ondatachannel = e => {
    const channel = e.channel;
    channel.binaryType = 'arraybuffer';

    receivedChunks = [];
    receivedBytes = 0;

    channel.onmessage = async (evt) => {
      const data = evt.data;

      if (typeof data === 'string' && data.startsWith('META:')) {
        const meta = JSON.parse(data.slice(5));
        incomingFileName = meta.name;
        expectedSize = meta.size;
        expectedHash = meta.hash;
        document.getElementById('incoming-name').textContent = meta.name;
        document.getElementById('incoming-meta').textContent = formatSize(meta.size) + ' — ' + (meta.type || 'unknown');
        document.getElementById('receiver-progress').style.display = 'block';
        transferStartTime = Date.now();
        lastSpeedSample = { time: Date.now(), bytes: 0 };
        return;
      }

      if (typeof data === 'string' && data === 'EOF') {
        // Reassemble
        setReceiverStatus('connecting', 'Verifying integrity\u2026');
        const fullBuffer = concatenateArrayBuffers(receivedChunks);
        const receivedHash = await sha256(fullBuffer);

        document.getElementById('receiver-hash-section').style.display = 'block';
        document.getElementById('receiver-hash-display').textContent = receivedHash;

        if (receivedHash === expectedHash) {
          document.getElementById('receiver-verify').style.display = 'flex';
          setReceiverStatus('connected', 'File received and verified!');
          channel.send('HASH_OK');
          // Auto-download
          const blob = new Blob([fullBuffer]);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = incomingFileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {
          document.getElementById('receiver-verify-fail').style.display = 'flex';
          setReceiverStatus('error', 'Hash mismatch — file corrupted!');
          channel.send('HASH_FAIL');
        }
        return;
      }

      // Binary chunk
      if (data instanceof ArrayBuffer) {
        receivedChunks.push(data);
        receivedBytes += data.byteLength;
        updateProgress(receivedBytes, expectedSize, 'r');
      }
    };

    channel.onerror = err => setReceiverStatus('error', 'Data channel error: ' + err.message);
  };
}

function concatenateArrayBuffers(buffers) {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}

// ────────────────────────────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────────────────────────────
function cleanupRTC() {
  if (dataChannel) { try { dataChannel.close(); } catch(e){} }
  if (peerConnection) { try { peerConnection.close(); } catch(e){} }
  dataChannel = null;
  peerConnection = null;
}

function resetApp() {
  cleanupRTC();
  if (socket) { socket.disconnect(); socket = null; }
  selectedFile = null;
  currentRoomId = null;
  isSender = false;
  receivedChunks = [];
  receivedBytes = 0;
  document.getElementById('file-input').value = '';
  document.getElementById('file-preview').style.display = 'none';
  document.getElementById('btn-share').disabled = true;
  document.getElementById('room-input').value = '';
  document.getElementById('join-error').style.display = 'none';
  showView('view-home');
}

function copyRoomId() {
  navigator.clipboard.writeText(currentRoomId).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'copied!';
    setTimeout(() => btn.textContent = 'copy', 1500);
  });
}
