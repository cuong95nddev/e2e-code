import { useState } from "react";
import { FolderOpen, ChevronLeft, ChevronRight } from "lucide-react";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="p-2 text-gray-500 hover:text-gray-300"
        title="Open file explorer"
      >
        <ChevronRight size={16} />
      </button>
    );
  }

  return (
    <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-950">
      <div className="flex items-center justify-between p-2 border-b border-gray-800">
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <FolderOpen size={14} />
          <span>Files</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-500 hover:text-gray-300"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
      <div className="flex-1 p-2 text-gray-500 text-xs">
        File explorer — coming soon
      </div>
    </div>
  );
}
