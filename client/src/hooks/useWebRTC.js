import { useRef, useState, useCallback } from "react";

// Size of each file chunk sent over the data channel (64 KB)
const CHUNK_SIZE = 64 * 1024;

// Google's public STUN server — helps peers discover their public IP/port
const STUN_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Returns a hex SHA-256 digest of an ArrayBuffer — used for file integrity checks
async function calculateSHA256(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useWebRTC(socket) {
  // Refs hold mutable values that shouldn't trigger re-renders
  const pcRef = useRef(null);           // RTCPeerConnection instance
  const dataChannelRef = useRef(null);  // RTCDataChannel for sending data
  const fileRef = useRef(null);         // File selected by the sender
  const roomIdRef = useRef(null);       // Shared room code for signalling

  // Receiver-side accumulator — chunks arrive out of order so we collect them all
  const receivedChunksRef = useRef([]);
  const incomingMetaRef = useRef(null);   // File metadata sent before the chunks
  const transferStartRef = useRef(null);  // Timestamp used to compute speed & ETA

  // UI state — these values are rendered by the parent components
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Idle");
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // 'disconnected' | 'waiting' | 'connected'
  const [transferSpeed, setTransferSpeed] = useState(0); // MB/s
  const [eta, setEta] = useState(null); // seconds
  const [senderHash, setSenderHash] = useState("");
  const [receiverHash, setReceiverHash] = useState("");
  const [verified, setVerified] = useState(false);
  const [messages, setMessages] = useState([]);

  // Setters that write into refs instead of state (no re-render needed)
  const setFile = (file) => { fileRef.current = file; };
  const setRoomId = (roomId) => { roomIdRef.current = roomId; };

  // Creates a new RTCPeerConnection and wires up ICE + connection-state callbacks
  const createPeer = () => {
    const pc = new RTCPeerConnection(STUN_CONFIG);

    // Forward discovered ICE candidates to the other peer via the signalling server
    pc.onicecandidate = (event) => {
      if (event.candidate && roomIdRef.current) {
        socket.emit("ice-candidate", { roomId: roomIdRef.current, candidate: event.candidate });
      }
    };

    // Sync connection status to UI; clear speed/ETA on disconnect
    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") setConnectionStatus("connected");
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        setConnectionStatus("disconnected");
        setTransferSpeed(0);
        setEta(null);
      }
    };

    pcRef.current = pc;
    return pc;
  };

  // Handles every message arriving on the data channel (chat, file meta, binary chunks)
  const handleMessage = useCallback((event) => {
    const data = event.data;

    if (typeof data === "string") {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // Append incoming chat message to the conversation list
      if (msg.type === "chat") {
        setMessages((prev) => [...prev, { text: msg.text, side: "them" }]);
        return;
      }

      // "meta" arrives before the binary chunks — store it and reset receiver state
      if (msg.type === "meta") {
        incomingMetaRef.current = msg;
        receivedChunksRef.current = [];
        transferStartRef.current = Date.now();
        setProgress(0);
        setTransferSpeed(0);
        setEta(null);
        setStatus("Receiving file...");
      }
      return;
    }

    // Binary chunk received — accumulate and update progress
    receivedChunksRef.current.push(data);
    const meta = incomingMetaRef.current;
    const received = receivedChunksRef.current.length;
    const percent = Math.round((received / meta.totalChunks) * 100);
    setProgress(percent);

    const elapsed = (Date.now() - transferStartRef.current) / 1000;
    const bytesReceived = received * CHUNK_SIZE;

    // Wait 0.5 s before computing speed to avoid wild early estimates
    if (elapsed > 0.5) {
      const speedMBs = bytesReceived / elapsed / (1024 * 1024);
      setTransferSpeed(speedMBs);
      const bytesRemaining = meta.size - bytesReceived;
      if (speedMBs > 0) setEta(bytesRemaining / (speedMBs * 1024 * 1024));
    }

    // All chunks received — trigger download and hash verification
    if (received === meta.totalChunks) {
      setTransferSpeed(0);
      setEta(null);
      downloadFile();
    }
  }, []);

  // Ref wrapper so attachChannel always calls the latest handleMessage closure
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  // Wires event handlers onto a data channel (used by both sender and receiver)
  const attachChannel = (channel) => {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (e) => handleMessageRef.current(e);
    channel.onopen = () => {
      console.log("[WebRTC] Data channel open.");
      setConnectionStatus("connected");
      setStatus("Connected. Ready.");
    };
    channel.onclose = () => {
      setConnectionStatus("disconnected");
      setStatus("Connection closed.");
      setTransferSpeed(0);
      setEta(null);
    };
    channel.onerror = (err) => {
      console.error("[WebRTC] Channel error:", err);
      setConnectionStatus("disconnected");
      setStatus("Connection error.");
    };
    dataChannelRef.current = channel;
  };

  // Sender flow: create data channel → build SDP offer → send to receiver via socket
  const startSender = async () => {
    setConnectionStatus("waiting");
    const pc = createPeer();
    const channel = pc.createDataChannel("file-transfer");
    attachChannel(channel);

    // Override onopen here so sendFile() starts immediately when the channel opens
    channel.onopen = () => {
      console.log("[WebRTC] Sender channel open.");
      setConnectionStatus("connected");
      setStatus("Connected. Sending file...");
      sendFile();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { roomId: roomIdRef.current, offer });
  };

  // Receiver flow: wait for the sender's data channel via ondatachannel event
  const startReceiver = () => {
    setConnectionStatus("waiting");
    setStatus("Waiting for sender...");
    const pc = createPeer();

    pc.ondatachannel = (event) => {
      attachChannel(event.channel);
      event.channel.onopen = () => {
        setConnectionStatus("connected");
        setStatus("Connected. Waiting for file...");
      };
    };
  };

  // Signalling: receiver processes the sender's SDP offer and replies with an answer
  const handleOffer = async (offer) => {
    const pc = pcRef.current;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { roomId: roomIdRef.current, answer });
  };

  // Signalling: sender stores the receiver's SDP answer to complete the handshake
  const handleAnswer = async (answer) => {
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
  };

  // Adds a remote ICE candidate — errors are swallowed (candidates can arrive early)
  const handleIceCandidate = async (candidate) => {
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.log("[WebRTC] ICE error:", e);
    }
  };

  // Reads the file, hashes it, sends a "meta" message, then streams chunks
  const sendFile = async () => {
    const file = fileRef.current;
    const channel = dataChannelRef.current;
    if (!file || !channel) return;

    const fileBuffer = await file.arrayBuffer();
    const fileHash = await calculateSHA256(fileBuffer);
    setSenderHash(fileHash);

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    channel.send(JSON.stringify({ type: "meta", name: file.name, size: file.size, totalChunks, hash: fileHash }));

    transferStartRef.current = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const chunk = fileBuffer.slice(start, Math.min(start + CHUNK_SIZE, file.size));

      // Back-pressure: pause if the send buffer exceeds 5 MB to avoid dropping chunks
      while (channel.bufferedAmount > 5 * 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 50));
      }

      channel.send(chunk);

      const elapsed = (Date.now() - transferStartRef.current) / 1000;
      const bytesSent = (i + 1) * CHUNK_SIZE;
      const percent = Math.round(((i + 1) / totalChunks) * 100);
      setProgress(percent);

      // Same 0.5 s warm-up as the receiver before computing speed/ETA
      if (elapsed > 0.5) {
        const speedMBs = bytesSent / elapsed / (1024 * 1024);
        setTransferSpeed(speedMBs);
        const bytesRemaining = file.size - bytesSent;
        if (speedMBs > 0) setEta(bytesRemaining / (speedMBs * 1024 * 1024));
      }
    }

    setTransferSpeed(0);
    setEta(null);
    setStatus("File sent successfully.");
  };

  // Reassembles chunks into a Blob, verifies SHA-256, then triggers browser download
  const downloadFile = async () => {
    const meta = incomingMetaRef.current;
    const blob = new Blob(receivedChunksRef.current);
    const buffer = await blob.arrayBuffer();
    const receivedHash = await calculateSHA256(buffer);
    setReceiverHash(receivedHash);

    // Abort download if hashes don't match — file is corrupted or tampered
    if (receivedHash !== meta.hash) {
      setVerified(false);
      setStatus("Hash mismatch — file may be corrupted.");
      return;
    }

    setVerified(true);
    // Create a temporary object URL, click it programmatically, then release it
    const url = URL.createObjectURL(new Blob([buffer]));
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("File received and verified.");
  };

  // Sends a chat message over the data channel; guards against closed/missing channel
  const sendChat = (text) => {
    const channel = dataChannelRef.current;
    if (!text.trim()) return;
    if (!channel) { setStatus("No data channel"); return; }
    console.log("[Chat] Channel state:", channel.readyState);
    if (channel.readyState !== "open") {
      setStatus(`Chat not ready: channel is "${channel.readyState}"`);
      return;
    }
    channel.send(JSON.stringify({ type: "chat", text }));
    setMessages((prev) => [...prev, { text, side: "me" }]);
  };
  const resetTransferState = () => {
  setProgress(0);
  setStatus("Idle");
  setTransferSpeed(0);
  setEta(null);
  setSenderHash("");
  setReceiverHash("");
  setVerified(false);

  receivedChunksRef.current = [];
  incomingMetaRef.current = null;
  transferStartRef.current = null;
};

  return {
    progress,
    status,
    connectionStatus,
    transferSpeed,
    eta,
    senderHash,
    receiverHash,
    verified,
    messages,
    sendChat,
    setFile,
    setRoomId,
    startSender,
    startReceiver,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    resetTransferState,
  };
}