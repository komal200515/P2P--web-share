import { useState } from "react";
import DropZone from "./DropZone";
/**
 * formatEta — converts raw seconds into a human-readable ETA string.
 * Uses Math.ceil so the display never reaches "0s" while time still remains —
 * it always rounds up toward the next whole second.
 */
function formatEta(seconds) {
   // Falsy guard covers null, undefined, 0 — all mean "no estimate yet"
  if (!seconds) return null;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}

function SenderView({ file, onFileSelect, onCreateRoom, roomId, progress, transferSpeed, eta, senderHash,userRole, }) {
// Computed flags for transfer progress and completion.
  const isTransferring = progress > 0 && progress < 100;
  const isDone = progress === 100 && senderHash;
  // Tracks copy success state for temporary feedback.
  const [copied, setCopied] = useState(false);
  // Copies the room ID and shows a temporary confirmation.
  const handleCopy = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      // Auto-reset after 2 s so the button is ready for another copy
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="glass p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white/90 text-sm uppercase tracking-widest">Send a file</h2>
        <span className="text-xs text-white/30 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
          Sender
        </span>
      </div>
      {/* File picker (drag & drop or browse). */}
      <DropZone onFileSelect={onFileSelect} file={file} />
      {/* Create room button (requires a selected file). */}
      <button
        onClick={onCreateRoom}
        disabled={!file}
        className="w-full py-3 rounded-xl font-semibold text-sm transition-all
          bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400
          text-white shadow-lg shadow-violet-500/20
          disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
      >
        Generate Share Code
      </button>

      {/* Room code with copy button */}
      {userRole === "sender" && roomId &&  (
        <div className="glass-dark p-4 text-center border border-violet-500/15 relative">
          <p className="text-xs text-white/25 uppercase tracking-[0.2em] mb-2">Room Code</p>
          {/* Extra letter spacing for better readability. */}
          <p className="text-2xl font-bold tracking-[0.35em] text-violet-300 font-mono">
            {roomId}
          </p>
          <p className="text-xs text-white/20 mt-2">Share this with the receiver</p>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 px-2 py-1.5 rounded-lg text-xs
              transition-all bg-white/8 hover:bg-violet-500/30 border border-white/10
              text-white/40 hover:text-violet-300"
          >
            {copied ? "✅" : "📋"}
          </button>

          {/* Toast */}
          {copied && (
            <p className="text-xs text-violet-400 mt-2">✓ Code copied!</p>
          )}
        </div>
      )}

      {/* Transfer progress and status information. */} 
      {(isTransferring || senderHash) && (
        
        <div className="space-y-2 pt-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-white/40">{progress}%</span>
            <div className="flex gap-3">
              {isTransferring && transferSpeed > 0 && (
                <span className="text-violet-400 font-mono">{transferSpeed.toFixed(2)} MB/s</span>
              )}
              {isTransferring && eta && (
                <span className="text-white/30 font-mono">ETA {formatEta(eta)}</span>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          {/* Progress bar fill with dynamic width and status colors. */}
            <div
              className={`h-full rounded-full transition-all duration-300 ${isDone ? "bg-emerald-400" : "progress-animated"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {isDone && (
            <p className="text-xs text-emerald-400 text-center">✅ File sent successfully</p>
          )}
        </div>
      )}

      {/* Compare this hash to confirm a successful transfer. */}
      {senderHash && (
        <div className="pt-2 border-t border-white/5">
          <p className="text-xs text-white/20 mb-1">SHA-256</p>
          <p className="break-all text-emerald-400/70 text-xs font-mono leading-relaxed">{senderHash}</p>
        </div>
      )}
    </div>
  );
}

export default SenderView;