import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { FileText, Edit3, Eye } from "lucide-react";
import {
  listReports,
  readReport,
  writeReport,
} from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { t } from "../lib/i18n";

type ViewMode = "edit" | "preview";

interface ReportsViewProps {
  onRefresh?: () => void;
}

export function ReportsView({ onRefresh }: ReportsViewProps) {
  const [reports, setReports] = useState<string[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef("");

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    try {
      const list = await listReports();
      setReports(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load reports:", e);
    }
  }

  async function handleSelectReport(filename: string) {
    setLoading(true);
    try {
      const text = await readReport(filename);
      setSelectedReport(filename);
      setContent(text);
      originalContentRef.current = text;
    } catch (e) {
      console.error("Failed to load report:", e);
    } finally {
      setLoading(false);
    }
  }

  function handleContentChange(newContent: string) {
    setContent(newContent);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      if (selectedReport && newContent !== originalContentRef.current) {
        try {
          await writeReport(selectedReport, newContent);
          originalContentRef.current = newContent;
          onRefresh?.();
        } catch (e) {
          console.error("Failed to save report:", e);
        }
      }
    }, 300);
  }

  return (
    <div className="flex h-full">
      {/* Reports list sidebar */}
      <div className="w-56 border-r overflow-hidden flex flex-col">
        <div className="p-3 border-b">
          <h3 className="text-sm font-medium">{t("reports.title")}</h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1">
            {reports.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("reports.noReports")}
              </div>
            ) : (
              reports.map((filename) => (
                <button
                  key={filename}
                  onClick={() => handleSelectReport(filename)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate ${
                    filename === selectedReport ? "bg-accent font-medium" : ""
                  }`}
                >
                  {filename.replace(/\.md$/, "")}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Report content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedReport ? (
          <>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-medium">{selectedReport.replace(/\.md$/, "")}</h3>
              <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                <button
                  onClick={() => setViewMode("edit")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                    viewMode === "edit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>{t("reports.edit")}</span>
                </button>
                <button
                  onClick={() => setViewMode("preview")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                    viewMode === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{t("reports.preview")}</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              {loading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t("app.loading")}
                </div>
              ) : viewMode === "edit" ? (
                <MarkdownEditor value={content} onChange={handleContentChange} className="h-full" />
              ) : (
                <MarkdownPreview content={content} className="h-full" />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="w-10 h-10 opacity-30 mb-2" />
            <p className="text-sm">{t("reports.selectReport")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
