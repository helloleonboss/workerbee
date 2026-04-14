import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { formatCurrentTime } from "../lib/utils";
import { X } from "lucide-react";

interface QuickInputProps {
  onSubmit: (content: string, time?: string) => Promise<void>;
  onClose: () => void;
  shortcutDisplay?: string;
}

export function QuickInput({ onSubmit, onClose, shortcutDisplay }: QuickInputProps) {
  const [content, setContent] = useState("");
  const [time, setTime] = useState(formatCurrentTime());
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto focus on open
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }, []);

  useEffect(() => {
    // ESC to close
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit() {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(content.trim(), time);
      setContent("");
      onClose();
    } catch (e) {
      console.error("Failed to submit:", e);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-background border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">快速记录</span>
            {shortcutDisplay && (
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">
                {shortcutDisplay}
              </kbd>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Time input */}
        <div className="px-4 pt-3">
          <label className="text-xs text-muted-foreground mb-1 block">时间</label>
          <Input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="font-mono text-sm h-8"
            placeholder="HH:mm"
          />
        </div>

        {/* Content */}
        <div className="px-4 pt-3 pb-3">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="记点什么..."
            className="min-h-[100px] resize-none text-sm"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-muted-foreground">
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Enter</kbd> 提交
              <span className="mx-1">·</span>
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Shift+Enter</kbd> 换行
              <span className="mx-1">·</span>
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">ESC</kbd> 关闭
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={!content.trim() || submitting}>
                {submitting ? "提交中..." : "提交"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}