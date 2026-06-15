import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import ChatBox from "./components/ChatBox";
import SenderView from "./components/senderview";
import ReceiverView from "./components/receiverView";
import { useWebRTC } from "./hooks/useWebRTC";

// Socket connection to signaling server
const socket = io("http://localhost:3000");

// Visual connection status badge
function ConnectionBadge({ status }) {
  const config = {
    connected:    { dot: "bg-green-400",               ring: "ring-green-500/30",  text: "text-green-400",  label: "Connected"    },
    waiting:      { dot: "bg-yellow-400 animate-pulse", ring: "ring-yellow-500/30", text: "text-yellow-400", label: "Waiting"      },
    disconnected: { dot: "bg-zinc-500",                ring: "ring-zinc-600/30",   text: "text-zinc-400",   label: "Disconnected" },
  };
  const c = config[status] || config.disconnected;

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ring-1 ${c.ring} bg-zinc-900`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      <span className={c.text}>{c.label}</span>
    </span>
  );
}

function App() {
  const [file, setFileState] = useState(null);
  const [roomId, setRoomIdState] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");
  // WebRTC state and actions
  const {
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
  } = useWebRTC(socket);

  // Keep refs fresh so socket listeners never go stale
  const startSenderRef = useRef(startSender);
  const startReceiverRef = useRef(startReceiver);
  const handleOfferRef = useRef(handleOffer);
  const handleAnswerRef = useRef(handleAnswer);
  const handleIceCandidateRef = useRef(handleIceCandidate);

  useEffect(() => {
    startSenderRef.current = startSender;
    startReceiverRef.current = startReceiver;
    handleOfferRef.current = handleOffer;
    handleAnswerRef.current = handleAnswer;
    handleIceCandidateRef.current = handleIceCandidate;
  });
     // Register signaling events
  useEffect(() => {
    socket.on("room-created", ({ roomId }) => {
      setRoomIdState(roomId);
      setRoomId(roomId);
      setMessage("Room created. Share this code with the receiver.");
    });
    socket.on("join-success", ({ roomId }) => {
      setRoomIdState(roomId);
      setRoomId(roomId);
      setMessage("Joined room. Waiting for sender...");
      startReceiverRef.current();
    });
    socket.on("receiver-joined", () => {
      setMessage("Receiver joined. Starting transfer...");
      startSenderRef.current();
    });
    socket.on("offer",         ({ offer })     => handleOfferRef.current(offer));
    socket.on("answer",        ({ answer })    => handleAnswerRef.current(answer));
    socket.on("ice-candidate", ({ candidate }) => handleIceCandidateRef.current(candidate));
    socket.on("join-error",    ({ message })   => setMessage(message));
    socket.on("transfer-done", ()              => setMessage("Transfer completed."));
    socket.on("peer-disconnected", ()          => setMessage("Peer disconnected."));

    return () => {
      ["room-created","join-success","receiver-joined","offer","answer",
       "ice-candidate","join-error","transfer-done","peer-disconnected"]
        .forEach((e) => socket.off(e));
    };
  }, []);

  // Store selected file locally and in WebRTC hook
  const handleFileSelect = (selectedFile) => {
    setFileState(selectedFile);
    setFile(selectedFile);
  };
  // Create a sharing room
  const createRoom = () => {
    if (!file) { setMessage("Please select a file first."); return; }
    socket.emit("create-room");
  };

  const joinRoom = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 8) { setMessage("Room code must be 8 characters."); return; }
    socket.emit("join-room", { roomId: code });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">

      {/* Header */}
      <header className="border-b border-zinc-800/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold">
            P
          </div>
          <span className="font-semibold tracking-tight">P2P Share</span>
        </div>
        <ConnectionBadge status={connectionStatus} />
      </header>

      {/* Hero sectioncd */}
      <div className="border-b border-zinc-800/40 px-6 py-12 text-center">
        <p className="text-xs font-semibold tracking-widest text-violet-400 uppercase mb-3">
          No servers. No limits.
        </p>
        <h1 className="text-5xl font-bold tracking-tight mb-3 bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-transparent">
          Send files directly.
        </h1>
        <p className="text-zinc-500 max-w-sm mx-auto text-sm">
          End-to-end encrypted transfers via WebRTC. Your file never touches our servers.
        </p>
      </div>

      <main className="max-w-4xl mx-auto p-6 space-y-4">

        {/* Info message */}
        {message && (
          <div className="px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-zinc-400">
            {message}
          </div>
        )}

        {/* Status row */}
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-zinc-600">{status}</p>
          <ConnectionBadge status={connectionStatus} />
        </div>

        {/* Sender + Receiver side by side */}
        <div className="grid md:grid-cols-2 gap-4">
          <SenderView
            file={file}
            onFileSelect={handleFileSelect}
            onCreateRoom={createRoom}
            roomId={roomId}
            progress={progress}
            transferSpeed={transferSpeed}
            eta={eta}
            senderHash={senderHash}
          />

          <ReceiverView
            joinCode={joinCode}
            onJoinCodeChange={setJoinCode}
            onJoinRoom={joinRoom}
            progress={progress}
            transferSpeed={transferSpeed}
            eta={eta}
            receiverHash={receiverHash}
            verified={verified}
          />
        </div>

        {/* Chat */}
        <ChatBox
          messages={messages}
          sendChat={sendChat}
          connectionStatus={connectionStatus}
        />

      </main>
    </div>
  );
}

export default App;