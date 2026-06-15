import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import ChatBox from "./components/ChatBox";
import SenderView from "./components/senderview";
import ReceiverView from "./components/receiverView";
import { useWebRTC } from "./hooks/useWebRTC";

// Socket connection to signaling server
// DEV → local server, PROD → hosted signaling server on Render
const socket = io(
  import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://p2p-web-share-c956.onrender.com",
);

// Visual connection status badge — renders a colored dot + label for each state
function ConnectionBadge({ status }) {
  // Maps each status string to its Tailwind classes and display label
  const config = {
    connected: {
      dot: "bg-green-400",
      ring: "ring-green-500/30",
      text: "text-green-400",
      label: "Connected",
    },
    waiting: {
      dot: "bg-yellow-400 animate-pulse", // pulse signals an in-progress handshake
      ring: "ring-yellow-500/30",
      text: "text-yellow-400",
      label: "Waiting",
    },
    disconnected: {
      dot: "bg-zinc-500",
      ring: "ring-zinc-600/30",
      text: "text-zinc-400",
      label: "Disconnected",
    },
  };

  // Fall back to disconnected style for any unknown status value
  const c = config[status] || config.disconnected;

  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ring-1 ${c.ring} bg-zinc-900`}
    >
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      <span className={c.text}>{c.label}</span>
    </span>
  );
}

function App() {
  // file + roomId are held in both React state (for UI) and WebRTC refs (for sending)
  const [file, setFileState] = useState(null);
  const [roomId, setRoomIdState] = useState("");
  const [joinCode, setJoinCode] = useState(""); // controlled input for the receiver's code entry
  const [message, setMessage] = useState(""); // one-line status/error banner
  const [userRole, setUserRole] = useState("none"); // "none" | "sender" | "receiver"

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
    handleReceiverJoined,
  } = useWebRTC(socket);

  // Refs keep the latest function closures accessible inside socket listeners
  // without needing to re-register those listeners on every render
  const startSenderRef = useRef(startSender);
  const startReceiverRef = useRef(startReceiver);
  const handleOfferRef = useRef(handleOffer);
  const handleAnswerRef = useRef(handleAnswer);
  const handleIceCandidateRef = useRef(handleIceCandidate);
  const handleReceiverJoinedRef = useRef(handleReceiverJoined);

  // Keep refs synced with latest hook functions after every render
  useEffect(() => {
    startSenderRef.current = startSender;
    startReceiverRef.current = startReceiver;
    handleOfferRef.current = handleOffer;
    handleAnswerRef.current = handleAnswer;
    handleIceCandidateRef.current = handleIceCandidate;
    handleReceiverJoinedRef.current = handleReceiverJoined;
  });

  // Register signaling events once on mount; clean up all listeners on unmount
  useEffect(() => {
    // Server assigned a new room — store the code and prompt the sender to share it
    socket.on("room-created", ({ roomId }) => {
      setRoomIdState(roomId);
      setRoomId(roomId);
      setMessage("Room created. Share this code with the receiver.");
      startSenderRef.current();
    });

    // Receiver entered a valid code — store room and start the WebRTC receiver flow
    socket.on("join-success", ({ roomId }) => {
      setRoomIdState(roomId);
      setRoomId(roomId);
      setMessage("Joined room. Waiting for sender...");
      startReceiverRef.current();
    });

    // Server tells the sender someone joined — kick off the sender WebRTC flow
    socket.on("receiver-joined", () => {
      setMessage("Receiver joined. Starting transfer...");
      handleReceiverJoinedRef.current();
    });

    // WebRTC signaling messages — forwarded directly into the hook
    socket.on("offer", ({ offer }) => handleOfferRef.current(offer));

    socket.on("answer", ({ answer }) => handleAnswerRef.current(answer));

    socket.on("ice-candidate", ({ candidate }) =>
      handleIceCandidateRef.current(candidate),
    );

    // Simple server-side status events
    socket.on("join-error", ({ message }) => setMessage(message));
    socket.on("transfer-done", () => setMessage("Transfer completed."));
    socket.on("peer-disconnected", () => setMessage("Peer disconnected."));

    // Remove all listeners on unmount to prevent memory leaks / duplicate handlers
    return () => {
      [
        "room-created",
        "join-success",
        "receiver-joined",
        "offer",
        "answer",
        "ice-candidate",
        "join-error",
        "transfer-done",
        "peer-disconnected",
      ].forEach((e) => socket.off(e));
    };
  }, []);

  // Syncs the selected file into both React state (UI) and the WebRTC hook (sending)
  const handleFileSelect = (selectedFile) => {
    setFileState(selectedFile);
    setFile(selectedFile);
  };

  // Validates a file is chosen, marks this client as sender, then asks server for a room
  const createRoom = () => {
    if (!file) {
      setMessage("Please select a file first.");
      return;
    }
    setUserRole("sender");
    socket.emit("create-room");
  };

  // Validates the 8-char code, marks this client as receiver, then asks server to join
  const joinRoom = () => {
    setUserRole("receiver");
    const code = joinCode.trim().toUpperCase();

    if (code.length !== 8) {
      setMessage("Room code must be 8 characters.");
      return;
    }

    socket.emit("join-room", { roomId: code });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Application header — logo left, live connection badge right */}
      <header className="border-b border-zinc-800/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold">
            P
          </div>
          <span className="font-semibold tracking-tight">P2P Share</span>
        </div>

        <ConnectionBadge status={connectionStatus} />
      </header>

      {/* Hero section — static marketing copy, no interactive elements */}
      <div className="border-b border-zinc-800/40 px-6 py-12 text-center">
        <p className="text-xs font-semibold tracking-widest text-violet-400 uppercase mb-3">
          No servers. No limits.
        </p>

        <h1 className="text-5xl font-bold tracking-tight mb-3 bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-transparent">
          Send files directly.
        </h1>

        <p className="text-zinc-500 max-w-sm mx-auto text-sm">
          End-to-end encrypted transfers via WebRTC. Your file never touches our
          servers.
        </p>
      </div>

      <main className="max-w-4xl mx-auto p-6 space-y-4">
        {/* System notification banner — hidden when message is empty */}
        {message && (
          <div className="px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-zinc-400">
            {message}
          </div>
        )}

        {/* Verbose hook status on the left, compact badge on the right */}
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-zinc-600">{status}</p>
          <ConnectionBadge status={connectionStatus} />
        </div>

        {/* Sender and receiver panels — stacked on mobile, side-by-side on md+ */}
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
            userRole={userRole} // lets SenderView dim/disable itself when role is "receiver"
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

        {/* Peer-to-peer chat — disabled until the data channel is open */}
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
