import { useRef, useEffect, useState } from "react";

function ChatBox({ messages, sendChat, connectionStatus }) {
  // Stores the current text being typed by the user
  const [chatText, setChatText] = useState("");
  // Reference to the bottom of the chat for auto-scrolling
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!chatText.trim()) return;
    sendChat(chatText);
    setChatText("");
  };
  // {Check whether WebRTC peer connection is active}
  const isConnected = connectionStatus === "connected";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Peer Chat</h2>
        {!isConnected && (
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded-md">
            Connect to chat
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="h-52 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-zinc-600 text-sm text-center pt-8">
            {isConnected
              ? "Say hello to your peer!"
              : "Connect to a peer to start chatting."}
          </p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`max-w-[75%] px-3 py-2 rounded-xl text-sm leading-snug ${
                msg.side === "me"
                  ? "ml-auto bg-violet-600 text-white rounded-br-sm"
                  : "mr-auto bg-zinc-800 text-white rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
          ))
        )}
        {/* Auto-scroll target element */}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={chatText}
          // Update input state while typing
          onChange={(e) => setChatText(e.target.value)}
           // Send message when Enter key is pressed
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder={
            isConnected ? "Type a message..." : "Waiting for connection..."
          }
          disabled={!isConnected}
          className="flex-1 px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-700
            outline-none focus:border-violet-500 transition-colors text-sm
            disabled:opacity-40 disabled:cursor-not-allowed"
        />
        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!chatText.trim() || !isConnected}
          className="px-5 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium
            transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default ChatBox;
