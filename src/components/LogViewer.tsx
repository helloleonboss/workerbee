import { useCallback } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { writeLog } from "../lib/api";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { t } from "../lib/i18n";
import { RichTextEditor } from "./RichTextEditor";

interface LogViewerProps {
  dates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  logContent: string;
  onRefresh: () => void;
  storagePath: string;
}

export function LogViewer({
  dates,
  selectedDate,
  onSelectDate,
  logContent,
  onRefresh,
  storagePath,
}: LogViewerProps) {
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

  const handleChange = useCallback(
    async (markdown: string) => {
      await writeLog(selectedDate, markdown);
      onRefresh();
    },
    [selectedDate, onRefresh],
  );

  return (
    <div className="flex h-full">
      {/* Sidebar: Date list */}
      <div className="w-32 border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("logs.date")}
          </h3>
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
                    date === selectedDate ? "bg-accent font-medium" : ""
                  }`}
                >
                  {date}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Content: single editor for the day */}
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

        <RichTextEditor
          content={logContent}
          storagePath={storagePath}
          onChange={handleChange}
          className="flex-1 overflow-auto p-2"
        />
      </div>
    </div>
  );
}
