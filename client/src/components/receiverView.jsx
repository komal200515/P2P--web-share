function formatEta(seconds) {
  // Return null so the caller can conditionally hide the ETA label entirely
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

function ReceiverView({
  joinCode,
  onJoinCodeChange,
  onJoinRoom,
  progress,
  transferSpeed,
  eta,
  receiverHash,
  verified,
}) {
  const isTransferring = progress > 0 && progress < 100;
  const isDone = progress === 100 && receiverHash;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Receive a file</h2>
        {/* Role badge - visually distinguishes this panel from the sender panel */}
        <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded-md">
          Receiver
        </span>
      </div>

      <p className="text-sm text-zinc-500">
        Enter the 8-character code from the sender to connect and download their
        file.
      </p>

      {/* ── Room code input ──
          - toUpperCase() normalises pasted/typed input so the user doesn't need
            to hold Shift — the code is always stored in uppercase internally.
          - maxLength={8} enforces the fixed code length at the DOM level.
          - tracking-[0.4em] spreads characters apart visually, making it easier
            to compare the code with what the sender shared.
      */}
{!receiverHash && (
  <>
    <input
      value={joinCode}
      onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
      maxLength={8}
      placeholder="XXXXXXXX"
      className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-700 text-center
        tracking-[0.4em] font-mono text-lg outline-none focus:border-violet-500 transition-colors"
    />

    <button
      onClick={onJoinRoom}
      disabled={joinCode.length !== 8}
      className="w-full py-3 rounded-xl font-semibold text-sm transition-all
        bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Join & Receive
    </button>
  </>
)}

      {/* ── Transfer progress ──
          Hidden entirely until progress > 0. This prevents a jarring flash of
          "0% — 0.00 MB/s — ETA 0s" when the component first mounts.
      */}
      {(isTransferring || receiverHash) && (
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>{progress}%</span>
            <div className="flex gap-3">
              {isTransferring && transferSpeed > 0 && (
                <span className="text-violet-400 font-mono">
                  {transferSpeed.toFixed(2)} MB/s
                </span>
              )}
              {isTransferring && eta !== null && (
                <span className="text-zinc-400 font-mono">
                  ETA {formatEta(eta)}
                </span>
              )}
            </div>
          </div>

          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            {/* Stats row: percentage on the left, speed + ETA on the right */}
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isDone ? "bg-emerald-500" : "bg-violet-600"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          {isDone && (
            <p className="text-xs text-emerald-400 text-center pt-1">
              ✅ File downloaded
            </p>
          )}
        </div>
      )}

      {/* ── Hash verification ──
          Rendered only after the receiver hash is available (i.e. the full file
          has been received and hashed). Shows the raw SHA-256 digest plus a
          pass/fail integrity result compared against the sender's hash.
      */}
      {receiverHash && (
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <div>
            <p className="text-xs text-zinc-600 mb-1">Receiver SHA-256</p>
            <p className="break-all text-green-400 text-xs font-mono">
              {receiverHash}
            </p>
          </div>
          <p
            className={`text-sm font-medium ${verified ? "text-emerald-400" : "text-red-400"}`}
          >
            {verified
              ? "✅ Integrity verified"
              : "❌ Hash mismatch — file may be corrupted"}
          </p>
        </div>
      )}
    </div>
  );
}

export default ReceiverView;