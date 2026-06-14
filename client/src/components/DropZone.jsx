import { useRef } from "react";

function DropZone({ onFileSelect }) {
  const fileRef = useRef();

  const handleChange = (e) => {
    const file = e.target.files[0];
    if (file) onFileSelect(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  return (
    <div
      className="border-2 border-dashed border-zinc-700 rounded-xl p-12 text-center cursor-pointer hover:border-violet-500 transition-colors"
      onClick={() => fileRef.current.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <input
        type="file"
        ref={fileRef}
        className="hidden"
        onChange={handleChange}
      />

      <h3 className="text-lg font-semibold">Drop a file here</h3>

      <p className="text-zinc-400 mt-2">or click to browse</p>
    </div>
  );
}

export default DropZone;