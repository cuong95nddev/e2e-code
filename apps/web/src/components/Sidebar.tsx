import { useState } from "react";
import { FolderOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);

  if (collapsed) {
    return (
      <Button
        onClick={() => setCollapsed(false)}
        variant="ghost"
        size="icon-xs"
        className="m-1"
        title="Open file explorer"
      >
        <ChevronRight />
      </Button>
    );
  }

  return (
    <div className="w-64 border-r border-border flex flex-col bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
          <FolderOpen className="size-3.5" />
          <span>Files</span>
        </div>
        <Button
          onClick={() => setCollapsed(true)}
          variant="ghost"
          size="icon-xs"
        >
          <ChevronLeft />
        </Button>
      </div>
      <Separator />
      <div className="flex-1 p-3 text-muted-foreground text-xs">
        File explorer — coming soon
      </div>
    </div>
  );
}
