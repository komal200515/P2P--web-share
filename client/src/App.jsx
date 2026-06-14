import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import DropZone from "./components/DropZone";
import { useWebRTC } from "./hooks/useWebRTC";

const socket = io("http://localhost:3000");

function App() {
  const [file, setFileState] = useState(null);
  const [roomId, setRoomIdState] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");
  const [chatText, setChatText] = useState("");

  const {
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
  } = useWebRTC(socket);

  // FIX: Keep refs to the latest versions of these functions so the
  // socket listeners (registered once) always call the current version.
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
      // FIX: Call via ref so we always get the latest version
      startReceiverRef.current();
    });

    socket.on("receiver-joined", () => {
      setMessage("Receiver joined. Starting transfer...");
      startSenderRef.current();
    });

    socket.on("offer", ({ offer }) => handleOfferRef.current(offer));
    socket.on("answer", ({ answer }) => handleAnswerRef.current(answer));
    socket.on("ice-candidate", ({ candidate }) =>
      handleIceCandidateRef.current(candidate)
    );

    socket.on("join-error", ({ message }) => setMessage(message));
    socket.on("transfer-done", () => setMessage("Transfer completed."));
    socket.on("peer-disconnected", () => setMessage("Peer disconnected."));

    return () => {
      socket.off("room-created");
      socket.off("join-success");
      socket.off("receiver-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("join-error");
      socket.off("transfer-done");
      socket.off("peer-disconnected");
    };
  }, []); // Runs once — refs keep the callbacks fresh

  const handleFileSelect = (selectedFile) => {
    setFileState(selectedFile);
    setFile(selectedFile);
  };

  const createRoom = () => {
    if (!file) {
      setMessage("Please select a file first.");
      return;
    }
    socket.emit("create-room");
  };

  const joinRoom = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 8) {
      setMessage("Room code must be 8 characters.");
      return;
    }
    socket.emit("join-room", { roomId: code });
  };

  const handleSendChat = () => {
    sendChat(chatText);
    setChatText("");
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 p-4">
        <h1 className="text-2xl font-bold">P2P Share</h1>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        <h2 className="text-4xl font-bold mb-4">
          File transfer, no middleman.
        </h2>

        <p className="text-zinc-400 mb-8">
          Files travel directly between browsers using WebRTC.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Send Panel */}
          <div className="border border-zinc-800 rounded-xl p-6">
            <h3 className="text-xl font-semibold mb-4">Send File</h3>

            <DropZone onFileSelect={handleFileSelect} />

            {file && (
              <div className="mt-4 p-4 border border-zinc-700 rounded-lg">
                <p className="font-medium">{file.name}</p>
                <p className="text-zinc-400 text-sm">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}

            <button
              onClick={createRoom}
              className="mt-5 w-full px-6 py-3 bg-violet-600 rounded-lg hover:bg-violet-500"
            >
              Generate Share Code
            </button>

            {roomId && (
              <div className="mt-4 p-4 bg-zinc-900 rounded-lg text-center">
                <p className="text-zinc-400 text-sm">Room Code</p>
                <button
  onClick={() => navigator.clipboard.writeText(roomId)}
  className="mt-3 px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-sm"
>
  Copy Code
</button>
                <p className="text-3xl font-bold tracking-widest text-violet-400">
                  {roomId}
                </p>
              </div>
            )}
          </div>

          {/* Receive Panel */}
          <div className="border border-zinc-800 rounded-xl p-6">
            <h3 className="text-xl font-semibold mb-4">Receive File</h3>

            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="Enter room code"
              className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-center tracking-widest outline-none"
            />

            <button
              onClick={joinRoom}
              className="mt-5 w-full px-6 py-3 bg-green-600 rounded-lg hover:bg-green-500"
            >
              Join Room
            </button>
          </div>
        </div>

        {/* Status Panel */}
        <div className="mt-6 p-4 bg-zinc-900 border border-zinc-700 rounded-lg">
          <p>
            <span className="text-zinc-400">Status:</span> {status}
          </p>
          <p>
            <span className="text-zinc-400">Message:</span> {message}
          </p>

          <div className="mt-4 h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="mt-2 text-sm text-zinc-400">{progress}%</p>

          {senderHash && (
            <div className="mt-4">
              <p className="text-sm text-zinc-400">Sender SHA-256:</p>
              <p className="break-all text-green-400 text-xs">{senderHash}</p>
            </div>
          )}

          {receiverHash && (
            <div className="mt-4">
              <p className="text-sm text-zinc-400">Receiver SHA-256:</p>
              <p className="break-all text-green-400 text-xs">{receiverHash}</p>
            </div>
          )}

          {receiverHash && (
            <p className="mt-3 font-semibold">
              {verified ? "✅ File integrity verified" : "❌ Hash mismatch"}
            </p>
          )}
        </div>

        {/* Chat Panel */}
        <div className="mt-6 p-4 bg-zinc-900 border border-zinc-700 rounded-lg">
          <h3 className="text-xl font-semibold mb-4">Peer Chat</h3>

          <div className="h-48 overflow-y-auto bg-black border border-zinc-800 rounded-lg p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-zinc-500 text-sm">No messages yet.</p>
            )}

            {messages.map((msg, index) => (
              <div
                key={index}
                className={`max-w-[75%] p-2 rounded-lg text-sm ${
                  msg.side === "me"
                    ? "ml-auto bg-violet-600 text-white"
                    : "mr-auto bg-zinc-800 text-white"
                }`}
              >
                {msg.text}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendChat();
              }}
              placeholder="Type message..."
              className="flex-1 p-3 rounded-lg bg-black border border-zinc-700 outline-none"
            />

            <button
              onClick={handleSendChat}
              className="px-5 py-3 bg-violet-600 rounded-lg hover:bg-violet-500"
            >
              Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;