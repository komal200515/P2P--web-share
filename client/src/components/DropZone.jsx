import { useRef, useState } from "react";

function DropZone({ onFileSelect, file }) {
  // Ref to the hidden <input type="file"> so we can trigger it programmatically
  const fileRef = useRef();
  // Track whether the user is currently dragging a file over the drop zone
  const [dragging, setDragging] = useState(false);

  // Called when the user picks a file via the file-browser dialog
  const handleChange = (e) => {
    const f = e.target.files[0]; // grab the first (and only) selected file
    if (f) onFileSelect(f);
  };
  // Called when the user releases (drops) a dragged file onto the zone
  const handleDrop = (e) => {
    e.preventDefault(); // prevent the browser from opening the file
    setDragging(false); // reset drag highlight
    const f = e.dataTransfer.files[0]; // grab the first dropped file
    if (f) onFileSelect(f);
  };
  // Called repeatedly while the user is dragging a file over the zone
  const handleDragOver = (e) => {
    e.preventDefault(); // required to allow the drop event to fire
    setDragging(true); // activate drag highlight
  };
  // Called when the dragged file leaves the drop zone area
  const handleDragLeave = () => setDragging(false);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div
      // Clicking anywhere on the zone opens the hidden file-browser dialog
      onClick={() => fileRef.current.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200
        ${
          dragging
            ? "border-violet-400 bg-violet-950/30 scale-[1.01]"
            : file
              ? "border-violet-600 bg-violet-950/10"
              : "border-zinc-700 hover:border-violet-500 hover:bg-zinc-900/50"
        }`}
    >
      {/*
        Hidden file input — clicking it opens the OS file-picker.
        We trigger it via fileRef.current.click() on the parent div's onClick.
      */}
      <input
        type="file"
        ref={fileRef}
        className="hidden"
        onChange={handleChange}
      />

      {file ? (
        // ── Selected-file state: show file name, size, and a change hint ──
        <div className="space-y-1">
          <div className="text-3xl">📄</div>
          {/* truncate keeps long filenames from breaking the layout */}
          <p className="font-semibold text-white truncate max-w-[200px] mx-auto">
            {file.name}
          </p>
          <p className="text-sm text-violet-400">{formatSize(file.size)}</p>
          <p className="text-xs text-zinc-500 mt-1">Click to change file</p>
        </div>
      ) : (
        // ── Empty state: prompt the user to drop or click ──
        <div className="space-y-2">
          <div className="text-4xl">{dragging ? "📂" : "☁️"}</div>
          <p className="font-semibold text-white">
            {dragging ? "Drop it!" : "Drop a file here"}
          </p>
          <p className="text-sm text-zinc-400">or click to browse</p>
        </div>
      )}
    </div>
  );
}

export default DropZone;
