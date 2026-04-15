import { useState, useRef } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { parseLogEntries, type LogEntry } from "../lib/utils";
import { readLog, writeLog } from "../lib/api";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { t } from "../lib/i18n";

interface LogViewerProps {
  dates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  logContent: string;
  onRefresh: () => void;
}

export function LogViewer({
  dates,
  selectedDate,
  onSelectDate,
  logContent,
  onRefresh,
}: LogViewerProps) {
  const entries = parseLogEntries(logContent);

  const currentIndex = dates.indexOf(selectedDate);

  function goPrev() {
    if (currentIndex < dates.length - 1) {
      onSelectDate(dates[currentIndex + 1]);
    }
  }

  function goNext() {
    if (currentIndex > 0) {
      onSelectDate(dates[currentIndex - 1]);
    }
  }

  const dateObj = new Date(selectedDate + "T00:00:00");
  const dateDisplay = isNaN(dateObj.getTime())
    ? selectedDate
    : dateObj.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      });

  // Inline editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTime, setEditTime] = useState("");
  const [editContent, setEditContent] = useState("");
  const editContentRef = useRef<HTMLTextAreaElement>(null);
  const editTimeRef = useRef<HTMLInputElement>(null);
  const latestEditTime = useRef("");
  const latestEditContent = useRef("");
  const isSaving = useRef(false);

  const syncEditTime = (v: string) => { setEditTime(v); latestEditTime.current = v; };
  const syncEditContent = (v: string) => { setEditContent(v); latestEditContent.current = v; };

  const startEdit = (index: number, entry: LogEntry, focusField?: "time" | "content") => {
    setEditingIndex(index);
    syncEditTime(entry.time);
    syncEditContent(entry.content);
    requestAnimationFrame(() => {
      const target = focusField === "time" ? editTimeRef.current : editContentRef.current;
      target?.focus();
      if (focusField !== "time" && editContentRef.current) {
        const len = editContentRef.current.value.length;
        editContentRef.current.setSelectionRange(len, len);
      }
    });
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    syncEditTime("");
    syncEditContent("");
  };

  const saveEdit = async (domTime?: string, domContent?: string) => {
    if (isSaving.current) return;
    const idx = editingIndex;
    if (idx === null) return;

    const originalEntry = entries[idx];
    const newTime = (domTime ?? latestEditTime.current).trim();
    const newContent = (domContent ?? latestEditContent.current).trim();

    isSaving.current = true;
    cancelEdit();

    try {
      const currentLog = await readLog(selectedDate);
      const allEntries = parseLogEntries(currentLog);

      if (!newContent) {
        // Empty content = delete entry
        const filtered = allEntries.filter(
          (e) => !(e.time === originalEntry.time && e.content === originalEntry.content)
        );
        let newLog = `---\ndate: ${selectedDate}\n---`;
        for (const entry of filtered) {
          newLog += `\n\n## ${entry.time}\n\n${entry.content}`;
        }
        await writeLog(selectedDate, newLog);
      } else if (newTime !== originalEntry.time || newContent !== originalEntry.content) {
        const entryIdx = allEntries.findIndex(
          (e) => e.time === originalEntry.time && e.content === originalEntry.content
        );
        if (entryIdx >= 0) {
          allEntries[entryIdx] = { time: newTime, content: newContent };
          let newLog = `---\ndate: ${selectedDate}\n---`;
          for (const entry of allEntries) {
            newLog += `\n\n## ${entry.time}\n\n${entry.content}`;
          }
          await writeLog(selectedDate, newLog);
        }
      }
      onRefresh();
    } catch (e) {
      console.error("Failed to save edit:", e);
    } finally {
      isSaving.current = false;
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar: Date list */}
      <div className="w-32 border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b">
          <h3 className="text-sm font-medium text-muted-foreground">{t("logs.date")}</h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1">
            {dates.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("logs.noLogs")}
              </div>
            ) : (
              dates.map((date) => (
                <button
                  key={date}
                  onClick={() => onSelectDate(date)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${
                    date === selectedDate
                      ? "bg-accent font-medium"
                      : ""
                  }`}
                >
                  {date}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {/* Date header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={goPrev}
              disabled={currentIndex >= dates.length - 1 || currentIndex === -1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h3 className="text-sm font-medium">{dateDisplay}</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={goNext}
              disabled={currentIndex <= 0 || currentIndex === -1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Log entries — file-like editing */}
        <ScrollArea className="flex-1">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 opacity-30 mb-2" />
              <p className="text-sm">{t("logs.noEntry")}</p>
            </div>
          ) : (
            <div className="p-4 divide-y divide-border">
              {entries.map((entry, i) => (
                <div
                  key={`${entry.time}-${i}`}
                  className="group py-3 px-1"
                >
                  {editingIndex === i ? (
                    <div>
                      <input
                        ref={editTimeRef}
                        value={editTime}
                        onChange={(e) => syncEditTime(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                          if (e.key === "Enter") { e.preventDefault(); editContentRef.current?.focus(); }
                        }}
                        onBlur={(e) => {
                          if (e.relatedTarget === editContentRef.current) return;
                          saveEdit(editTimeRef.current?.value, editContentRef.current?.value);
                        }}
                        className="w-full block bg-transparent text-xs font-mono text-muted-foreground outline-none border-0 mb-0.5 p-0 h-auto"
                        placeholder="HH:mm"
                      />
                      <textarea
                        ref={editContentRef}
                        value={editContent}
                        onChange={(e) => syncEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(editTimeRef.current?.value, editContentRef.current?.value); }
                        }}
                        onBlur={(e) => {
                          if (e.relatedTarget === editTimeRef.current) return;
                          saveEdit(editTimeRef.current?.value, editContentRef.current?.value);
                        }}
                        className="w-full bg-transparent text-sm whitespace-pre-wrap leading-relaxed resize-none outline-none border-0 min-h-[1.5em] p-0 caret-foreground"
                        rows={editContent.split("\n").length}
                      />
                    </div>
                  ) : (
                    <div
                      className="cursor-text"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        const focusField = target.dataset.field === "time" ? "time" : "content";
                        startEdit(i, entry, focusField);
                      }}
                    >
                      <div data-field="time" className="text-xs font-mono text-muted-foreground mb-0.5">{entry.time}</div>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
