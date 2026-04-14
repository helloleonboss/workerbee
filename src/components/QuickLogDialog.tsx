import { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveLog } from "@/lib/api";
import { formatCurrentTime, formatCurrentDate } from "@/lib/utils";

interface QuickLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function QuickLogDialog({ open, onOpenChange, onSaved }: QuickLogDialogProps) {
  const [time, setTime] = useState(formatCurrentTime);
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTime(formatCurrentTime());
      setContent("");
      // Focus textarea after dialog animation
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) return;

    // Validate time format (HH:mm)
    const timeRegex = /^\d{1,2}:\d{2}$/;
    const finalTime = timeRegex.test(time) ? time : formatCurrentTime();

    try {
      await saveLog(formatCurrentDate(), finalTime, content.trim());
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      console.error("save_log failed:", e);
    }
  }, [content, time, onOpenChange, onSaved]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>记一笔</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground shrink-0">时间</label>
            <Input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="HH:mm"
              className="w-28 font-mono text-sm"
            />
          </div>
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="记录此刻的想法..."
            className="min-h-[120px] resize-none"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">Enter</kbd> 提交
              <span className="mx-1">·</span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">Shift+Enter</kbd> 换行
            </p>
            <Button size="sm" onClick={handleSubmit} disabled={!content.trim()}>
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
