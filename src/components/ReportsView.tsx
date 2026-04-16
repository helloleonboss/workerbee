import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { FileText, Plus } from "lucide-react";
import { listReports, readReport, writeReport, generateReport, listTemplates } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { t } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface ReportsViewProps {
  onRefresh?: () => void;
}

export function ReportsView({ onRefresh }: ReportsViewProps) {
  const [reports, setReports] = useState<string[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  // Generator state
  const [showGenerator, setShowGenerator] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [dateEnd, setDateEnd] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef("");

  // Load reports list on mount
  useEffect(() => {
    loadReports();
  }, []);

  // Load templates when generator is shown
  useEffect(() => {
    if (showGenerator) {
      loadTemplates();
    }
  }, [showGenerator]);

  async function loadTemplates() {
    try {
      const list = await listTemplates();
      setTemplates(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }

  async function loadReports() {
    try {
      const list = await listReports();
      setReports(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load reports:", e);
    }
  }

  async function loadReport(filename: string) {
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

    // Debounced auto-save
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

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const filename = await generateReport(dateStart, dateEnd, selectedTemplate);
      await loadReports();
      await loadReport(filename);
      setShowGenerator(false);
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Display filename without .md extension
  function displayName(filename: string): string {
    return filename.replace(/\.md$/, "");
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: Report list */}
      <div className="w-48 border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("reports.title")}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowGenerator(!showGenerator)}
            title={t("reports.generate")}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Generator form */}
        {showGenerator && (
          <div className="p-3 border-b space-y-3 bg-muted/30">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("reports.dateRange")}
              </label>
              <div className="flex gap-1">
                <Input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="flex-1 text-xs h-7"
                />
                <span className="text-xs text-muted-foreground self-center">-</span>
                <Input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="flex-1 text-xs h-7"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("reports.selectTemplate")}
              </label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger className="text-xs h-7">
                  <SelectValue placeholder={t("reports.noTemplate")} />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      {t("reports.noTemplate")}
                    </SelectItem>
                  ) : (
                    templates.map((tmpl) => (
                      <SelectItem key={tmpl} value={tmpl}>
                        {tmpl}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {genError && (
              <p className="text-xs text-destructive">{genError}</p>
            )}

            <Button
              size="sm"
              className="w-full"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? t("reports.generating") : t("reports.generate")}
            </Button>
          </div>
        )}

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
                  onClick={() => loadReport(filename)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate ${
                    filename === selectedReport
                      ? "bg-accent font-medium"
                      : ""
                  }`}
                >
                  {displayName(filename)}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {selectedReport ? (
          <>
            {/* Filename header */}
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">
                {displayName(selectedReport)}
              </h3>
            </div>

            {/* Report content */}
            <div className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t("app.loading")}
                </div>
              ) : (
                <MarkdownEditor
                  value={content}
                  onChange={handleContentChange}
                />
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