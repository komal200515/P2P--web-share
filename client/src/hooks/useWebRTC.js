import { useRef, useState, useCallback } from "react";

const CHUNK_SIZE = 64 * 1024;

const STUN_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

async function calculateSHA256(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useWebRTC(socket) {
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileRef = useRef(null);
  const roomIdRef = useRef(null);

  const receivedChunksRef = useRef([]);
  const incomingMetaRef = useRef(null);

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Idle");
  const [senderHash, setSenderHash] = useState("");
  const [receiverHash, setReceiverHash] = useState("");
  const [verified, setVerified] = useState(false);
  const [messages, setMessages] = useState([]);

  const setFile = (file) => {
    fileRef.current = file;
  };

  const setRoomId = (roomId) => {
    roomIdRef.current = roomId;
  };

  const createPeer = () => {
    const pc = new RTCPeerConnection(STUN_CONFIG);

    pc.onicecandidate = (event) => {
      if (event.candidate && roomIdRef.current) {
        socket.emit("ice-candidate", {
          roomId: roomIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    // Log connection state changes to help debug signaling issues
    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE connection state:", pc.iceConnectionState);
    };

    pcRef.current = pc;
    return pc;
  };

  // FIX: Wrap handleMessage in useCallback so it's stable,
  // but use functional state updates (prev =>) so it never goes stale.
  const handleMessage = useCallback((event) => {
    const data = event.data;

    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.type === "chat") {
        // Functional update — no stale closure risk
        setMessages((prev) => [...prev, { text: msg.text, side: "them" }]);
        return;
      }

      if (msg.type === "meta") {
        incomingMetaRef.current = msg;
        receivedChunksRef.current = [];
        setProgress(0);
        setStatus("Receiving file...");
      }

      return;
    }

    receivedChunksRef.current.push(data);

    const meta = incomingMetaRef.current;
    const percent = Math.round(
      (receivedChunksRef.current.length / meta.totalChunks) * 100
    );

    setProgress(percent);

    if (receivedChunksRef.current.length === meta.totalChunks) {
      downloadFile();
    }
  }, []); // Empty deps — safe because all state updates use functional form

  // FIX: Keep a ref to the latest handleMessage so data channel
  // callbacks always call the current version, never a stale one.
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const attachChannel = (channel) => {
    channel.binaryType = "arraybuffer";

    // FIX: Delegate to ref so the handler is always fresh
    channel.onmessage = (e) => handleMessageRef.current(e);

    channel.onopen = () => {
      console.log("[WebRTC] Data channel open. State:", channel.readyState);
      setStatus("Connected. Ready to send/receive files and chat.");
    };

    channel.onclose = () => {
      console.log("[WebRTC] Data channel closed.");
      setStatus("Data channel closed.");
    };

    channel.onerror = (err) => {
      console.error("[WebRTC] Data channel error:", err);
      setStatus("Data channel error. Check console.");
    };

    dataChannelRef.current = channel;
  };

  const startSender = async () => {
    const pc = createPeer();
    const channel = pc.createDataChannel("file-transfer");
    attachChannel(channel);

    channel.onopen = () => {
      console.log("[WebRTC] Sender channel open.");
      setStatus("Connected. Sending file...");
      sendFile();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { roomId: roomIdRef.current, offer });
  };

  const startReceiver = () => {
    const pc = createPeer();

    pc.ondatachannel = (event) => {
      console.log("[WebRTC] Receiver got data channel.");
      attachChannel(event.channel);

      // Override onopen after attachChannel sets a generic one
      event.channel.onopen = () => {
        console.log("[WebRTC] Receiver channel open.");
        setStatus("Connected. Waiting for file...");
      };
    };
  };

  const handleOffer = async (offer) => {
    const pc = pcRef.current;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", { roomId: roomIdRef.current, answer });
  };

  const handleAnswer = async (answer) => {
    const pc = pcRef.current;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const handleIceCandidate = async (candidate) => {
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.log("[WebRTC] ICE error:", error);
    }
  };

  const sendFile = async () => {
    const file = fileRef.current;
    const channel = dataChannelRef.current;

    if (!file || !channel) return;

    const fileBuffer = await file.arrayBuffer();
    const fileHash = await calculateSHA256(fileBuffer);
    setSenderHash(fileHash);

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    channel.send(
      JSON.stringify({
        type: "meta",
        name: file.name,
        size: file.size,
        totalChunks,
        hash: fileHash,
      })
    );

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = fileBuffer.slice(start, end);

      while (channel.bufferedAmount > 5 * 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      channel.send(chunk);
      setProgress(Math.round(((i + 1) / totalChunks) * 100));
    }

    setStatus("File sent successfully.");
  };

  const downloadFile = async () => {
    const meta = incomingMetaRef.current;
    const blob = new Blob(receivedChunksRef.current);
    const buffer = await blob.arrayBuffer();

    const receivedHash = await calculateSHA256(buffer);
    setReceiverHash(receivedHash);

    if (receivedHash !== meta.hash) {
      setVerified(false);
      setStatus("Hash mismatch. File may be corrupted.");
      return;
    }

    setVerified(true);

    const url = URL.createObjectURL(new Blob([buffer]));
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.name;
    a.click();
    URL.revokeObjectURL(url);

    setStatus("File received and verified successfully.");
  };

  const sendChat = (text) => {
    const channel = dataChannelRef.current;

    if (!text.trim()) return;

    if (!channel) {
      setStatus("Chat not ready: no data channel");
      console.warn("[Chat] dataChannelRef is null");
      return;
    }

    // FIX: Log the actual state so you can debug if it's not "open"
    console.log("[Chat] Channel state:", channel.readyState);

    if (channel.readyState !== "open") {
      setStatus(`Chat not ready: channel is "${channel.readyState}"`);
      return;
    }

    channel.send(JSON.stringify({ type: "chat", text }));
    setMessages((prev) => [...prev, { text, side: "me" }]);
  };

  return {
    progress,
    status,
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
  };
}