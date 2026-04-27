import { useState, useRef, useEffect, useCallback, Component, Fragment, type ReactNode, type ErrorInfo } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { FileText, Edit3, Eye, Sparkles, Loader2, Plus, Trash2 } from "lucide-react";
import {
  listReports,
  readReport,
  writeReport,
  readLog,
  listLogs,
  saveConfig,
  listTemplates,
  writeTemplate,
  deleteTemplate,
  AI_PROVIDERS,
  DEFAULT_AI_MODEL,
  type AppConfig,
  type AiConfig,
  type TemplateInfo,
} from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { t } from "../lib/i18n";
import { generateReport, type ChatMessage } from "../lib/ai/generate";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { registry } from "../lib/ai/registry";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
} from "@json-render/react";
import type { Spec } from "@json-render/core";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";

// Error boundary to prevent white screen on Renderer crash
class RenderErrorBoundary extends Component<
  { children: ReactNode; fallback?: (error: Error) => ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Renderer] crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback?.(this.state.error) ?? (
          <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-md p-3">
            <p className="font-medium mb-1">渲染出错</p>
            <pre className="text-xs whitespace-pre-wrap break-words">
              {this.state.error.message}
            </pre>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

type ViewMode = "edit" | "preview";

interface ReportsViewProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onRefresh?: () => void;
}

export function ReportsView({ config, onConfigChange, onRefresh }: ReportsViewProps) {
  const [reports, setReports] = useState<string[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  // Template state (file-based)
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [templateViewMode, setTemplateViewMode] = useState<ViewMode>("edit");

  // Generation state
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Multi-turn conversation state
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);
  const [lastLogsContent, setLastLogsContent] = useState("");
  const [lastDateLabel, setLastDateLabel] = useState("");
  const [lastFormatPrompt, setLastFormatPrompt] = useState("");

  // Cached log files for two-phase selection (keyed by date)
  const [cachedLogFiles, setCachedLogFiles] = useState<{ id: string; summary: string; fullContent: string }[]>([]);
  const [specPhase, setSpecPhase] = useState<"selection" | "generation" | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const templateSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef("");

  const persistConfig = useCallback(
    (updates: Partial<AppConfig>) => {
      const newConfig: AppConfig = { ...config, ...updates };
      onConfigChange(newConfig);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await saveConfig(newConfig);
        } catch (e) {
          console.error("Failed to save config:", e);
        }
      }, 300);
    },
    [config, onConfigChange]
  );

  const aiConfigured = !!(config.ai?.api_key);

  useEffect(() => {
    loadReports();
    loadTemplates();
  }, []);

  async function loadReports() {
    try {
      const list = await listReports();
      setReports(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load reports:", e);
    }
  }

  async function loadTemplates() {
    try {
      const list = await listTemplates();
      setTemplates(list);
      // Auto-select first template if none selected
      if (!config.selected_report_preset && list.length > 0) {
        persistConfig({ selected_report_preset: list[0].filename });
      }
    } catch (e) {
      console.error("Failed to load templates:", e);
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

  function getDateRangeDates(range: "today" | "week" | "month") {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);

    if (range === "today") {
      start.setHours(0, 0, 0, 0);
    } else if (range === "week") {
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    }

    const fmt = (d: Date) => d.toISOString().split("T")[0];
    return {
      start,
      end,
      label: start.getTime() === end.getTime() ? fmt(start) : `${fmt(start)} ~ ${fmt(end)}`,
    };
  }

  /** Extract a one-line summary from a log file (first non-empty, non-frontmatter line) */
  function extractFileSummary(content: string): string {
    const lines = content.split("\n");
    let pastFrontmatter = false;
    for (const line of lines) {
      if (line.trim() === "---") {
        if (pastFrontmatter) { pastFrontmatter = false; continue; }
        pastFrontmatter = true;
        continue;
      }
      if (pastFrontmatter) continue;
      if (line.startsWith("## ")) {
        // Take the text after the time heading
        return line.replace(/^## \d{2}:\d{2}\s*/, "").trim() || line.trim();
      }
      if (line.trim()) return line.trim();
    }
    return "";
  }

  async function handleGenerate(followUpMessage?: string) {
    const aiConfigToUse: AiConfig = config.ai!;

    setGenerating(true);
    setSpec(null);
    setGeneratedReport(null);
    setGenError(null);
    setReasoningText("");

    try {
      let logsContent = lastLogsContent;
      let label = lastDateLabel;
      let formatPrompt = lastFormatPrompt;
      let phase: "selection" | "generation" = "generation";

      if (!followUpMessage || !conversationHistory.length) {
        phase = "selection";
      }
      setSpecPhase(phase);

      if (!followUpMessage || !conversationHistory.length) {
        // Derive date range from selected template
        const tmpl = templates.find((t) => t.filename === config.selected_report_preset);
        const range = (tmpl?.date_range as "today" | "week" | "month") || "week";
        const { start, end, label: rangeLabel } = getDateRangeDates(range);
        label = rangeLabel;

        // Fetch all log files in range
        const allFiles: { id: string; summary: string; fullContent: string }[] = [];

        try {
          const dates = await listLogs();
          for (const date of dates) {
            const d = new Date(date);
            if (d >= start && d <= end) {
              try {
                const log = await readLog(date);
                if (log.trim()) {
                  const summary = extractFileSummary(log);
                  allFiles.push({ id: date, summary, fullContent: log });
                }
              } catch {
                /* skip unreadable logs */
              }
            }
          }
        } catch (e) {
          console.error("Failed to list logs:", e);
        }

        if (allFiles.length === 0) {
          setGenerating(false);
          setGenError(t("reports.generate.noLogs"));
          return;
        }

        // Cache full files for phase 2
        setCachedLogFiles(allFiles);
        setSpecPhase("selection");
        setLastDateLabel(label);
        setLastFormatPrompt(tmpl?.prompt || "");
        setConversationHistory([]);

        // Ask AI which files to pre-select
        const fileNames = allFiles.map((f) => f.id).join(", ");

        const reportType = tmpl?.date_range === "today" ? "日报" : tmpl?.date_range === "month" ? "月报" : "周报";

        let aiSelectedIds: string[] = [];
        try {
          const url = `${aiConfigToUse.api_base_url}/chat/completions`;
          const resp = await tauriFetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(aiConfigToUse.api_key ? { Authorization: `Bearer ${aiConfigToUse.api_key}` } : {}),
            },
            body: JSON.stringify({
              model: aiConfigToUse.model,
              messages: [
                {
                  role: "system",
                  content: "你是一个工作日志分析助手。用户会提供日志文件的日期和概要列表，你需要判断哪些文件与生成报告最相关。只返回一个JSON数组，包含推荐的文件日期字符串。不要返回任何其他内容。",
                },
                {
                  role: "user",
                  content: `日期范围 ${label} 内有以下日志文件：${fileNames}。这是要生成${reportType}。请返回一个JSON数组，包含应该包含在${reportType}中的文件日期字符串。如果都相关就全选。只返回JSON数组，不要其他文字。`,
                },
              ],
              temperature: 0.3,
            }),
          });

          if (resp.ok) {
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content || "";
            // Extract JSON array from response (may be wrapped in markdown code block)
            const jsonMatch = content.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (Array.isArray(parsed)) {
                // Validate that the IDs exist in our file list
                const validIds = new Set(allFiles.map((f) => f.id));
                aiSelectedIds = parsed.filter((id: string) => validIds.has(id));
              }
            }
          }
        } catch (e) {
          console.error("AI pre-selection failed, defaulting to all:", e);
        }

        // Fallback: if AI returned nothing useful, select all
        if (aiSelectedIds.length === 0) {
          aiSelectedIds = allFiles.map((f) => f.id);
        }

        setSelectedFileIds(new Set(aiSelectedIds));
        setGenerating(false);
        return;
      } else {
        // Follow-up — always generation phase
        phase = "generation";
      }

      // Build conversation history for this round
      let historyForApi: ChatMessage[] | undefined;
      if (followUpMessage && conversationHistory.length) {
        historyForApi = [...conversationHistory, { role: "user" as const, content: followUpMessage }];
      }

      await generateReport({
        aiConfig: aiConfigToUse,
        logs: logsContent,
        dateRange: label,
        customInstruction: formatPrompt,
        conversationHistory: historyForApi,
        phase,
        onTextUpdate: (text) => setStreamingText(text),
        onReasoningUpdate: (text) => setReasoningText(text),
        onSpecUpdate: (s) => {
          setSpec(s);
        },
        onComplete: (s, text, updatedHistory) => {
          setGenerating(false);
          setConversationHistory(updatedHistory);
          if (s) {
            setSpec(s);
          } else {
            setGeneratedReport(text);
          }
        },
        onError: (err) => {
          setGenerating(false);
          setGenError(err.message || String(err));
        },
      });
    } catch (e) {
      setGenerating(false);
      setGenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleConfirmLogs(selectedIds: string[]) {
    const selectedFiles = cachedLogFiles.filter((f) => selectedIds.includes(f.id));

    if (selectedFiles.length === 0) {
      setSpec(null);
      setGenError(t("reports.generate.noLogs"));
      return;
    }

    // Build full content from selected files
    const fullLogs = selectedFiles
      .map((f) => `=== ${f.id} ===\n${f.fullContent}`)
      .join("\n\n");

    const tmpl = templates.find((t) => t.filename === config.selected_report_preset);
    const range = (tmpl?.date_range as "today" | "week" | "month") || "week";
    const { label } = getDateRangeDates(range);

    setGenerating(true);
    setSpec(null);
    setGeneratedReport(null);
    setGenError(null);
    setReasoningText("");
    setStreamingText("");
    setSpecPhase("generation");
    setLastLogsContent(fullLogs);

    try {
      await generateReport({
        aiConfig: config.ai!,
        logs: fullLogs,
        dateRange: label,
        customInstruction: tmpl?.prompt || "",
        phase: "generation",
        onTextUpdate: (text) => setStreamingText(text),
        onReasoningUpdate: (text) => setReasoningText(text),
        onSpecUpdate: (s) => setSpec(s),
        onComplete: (s, text, updatedHistory) => {
          setGenerating(false);
          setConversationHistory(updatedHistory);
          if (s) setSpec(s);
          else setGeneratedReport(text);
        },
        onError: (err) => {
          setGenerating(false);
          setGenError(err.message || String(err));
        },
      });
    } catch (e) {
      setGenerating(false);
      setGenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaveReport() {
    if (!spec && !generatedReport) return;

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `report-${dateStr}`;

    // Extract content from spec or use raw text
    let reportContent = generatedReport || "";
    if (spec?.elements) {
      for (const el of Object.values(spec.elements)) {
        const elem = el as { type?: string; props?: { content?: string; title?: string } };
        if (elem.type === "ReportPreview" && elem.props?.content) {
          reportContent = `# ${elem.props.title || "Report"}\n\n${elem.props.content}`;
          break;
        }
      }
    }

    try {
      await writeReport(filename, reportContent);
      await loadReports();
      setSelectedReport(filename);
      setContent(reportContent);
      originalContentRef.current = reportContent;

      // Close dialog and reset generation state
      setGenDialogOpen(false);
      setSpec(null);
      setGeneratedReport(null);
      setGenError(null);
      setStreamingText("");
      setReasoningText("");
      setSpecPhase(null);
    } catch (e) {
      console.error("Failed to save report:", e);
    }
  }

  // --- Template CRUD ---
  function handleStartEditTemplate(tmpl: TemplateInfo) {
    setEditingFilename(tmpl.filename);
    setEditName(tmpl.name);
    setEditPrompt(tmpl.prompt);
    setTemplateViewMode("preview");
  }

  function autoSaveTemplate() {
    if (!editingFilename) return;
    if (templateSaveRef.current) clearTimeout(templateSaveRef.current);
    templateSaveRef.current = setTimeout(async () => {
      try {
        await writeTemplate(editingFilename, editName, null, editPrompt);
        await loadTemplates();
      } catch (e) {
        console.error("Failed to save template:", e);
      }
    }, 500);
  }

  async function handleAddTemplate() {
    const newFilename = `custom-${Date.now().toString(36)}`;
    try {
      await writeTemplate(newFilename, t("reports.config.newPresetName"), null, "");
      await loadTemplates();
      // Start editing the new template
      setEditingFilename(newFilename);
      setEditName(t("reports.config.newPresetName"));
      setEditPrompt("");
      setTemplateViewMode("edit");
    } catch (e) {
      console.error("Failed to add template:", e);
    }
  }

  async function handleDeleteTemplate(filename: string) {
    try {
      await deleteTemplate(filename);
      await loadTemplates();
      if (config.selected_report_preset === filename) {
        const remaining = templates.filter((t) => t.filename !== filename);
        persistConfig({
          selected_report_preset: remaining.length > 0 ? remaining[0].filename : undefined,
        });
      }
      if (editingFilename === filename) {
        setEditingFilename(null);
      }
    } catch (e) {
      console.error("Failed to delete template:", e);
    }
  }

  // Model selector helpers
  const currentProviderKey = (config.ai?.provider && config.ai.provider in AI_PROVIDERS
    ? config.ai.provider
    : "opencode-go") as keyof typeof AI_PROVIDERS;

  const currentModelValue = `${currentProviderKey}::${config.ai?.model || DEFAULT_AI_MODEL}`;

  function handleModelSelectChange(compositeValue: string) {
    const sepIdx = compositeValue.indexOf("::");
    if (sepIdx === -1) return;
    const providerKey = compositeValue.slice(0, sepIdx);
    const model = compositeValue.slice(sepIdx + 2);
    const provider = AI_PROVIDERS[providerKey as keyof typeof AI_PROVIDERS];
    if (!config.ai || !provider) return;
    persistConfig({
      ai: {
        ...config.ai,
        provider: providerKey,
        api_base_url: provider.baseUrl || config.ai.api_base_url,
        model,
      },
    });
  }

  // Determine generate dialog visual state
  const isSelectingFiles = specPhase === "selection" && !generating && cachedLogFiles.length > 0;
  const isGenIdle = !generating && !spec && !generatedReport && !genError && specPhase !== "selection";
  const isGenComplete = !generating && (spec !== null || generatedReport !== null);

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

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Simplified toolbar */}
        <div className="px-4 py-2 border-b flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => setGenDialogOpen(true)}
            disabled={!aiConfigured && !generating && !spec && !generatedReport}
          >
            {generating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                {t("reports.generate.generating")}
              </>
            ) : spec || generatedReport ? (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {t("reports.generate.button")}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {t("reports.generate.button")}
              </>
            )}
          </Button>
        </div>

        {/* Template Management Dialog */}
        <Dialog open={manageDialogOpen} onOpenChange={(open) => { setManageDialogOpen(open); if (!open) setEditingFilename(null); }}>
          <DialogContent className="max-w-3xl flex flex-col overflow-hidden" style={{ height: "80vh" }}>
            <DialogHeader>
              <DialogTitle>{t("reports.config.presetsTitle")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-1 min-h-0 gap-4">
              {/* Left: Template list */}
              <div className="w-48 flex flex-col min-h-0 border rounded-md">
                <div className="flex-1 overflow-y-auto">
                  {templates.map((tmpl) => (
                    <div
                      key={tmpl.filename}
                      onClick={() => handleStartEditTemplate(tmpl)}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                        editingFilename === tmpl.filename
                          ? "bg-accent font-medium"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <span className="flex-1 truncate">{tmpl.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tmpl.filename); }}
                        className="p-0.5 rounded-sm text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t">
                  <Button variant="outline" size="sm" className="w-full" onClick={handleAddTemplate}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t("reports.config.addPreset")}
                  </Button>
                </div>
              </div>
              {/* Right: Editor */}
              <div className="flex-1 flex flex-col min-h-0">
                {editingFilename ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <Input
                        value={editName}
                        onChange={(e) => { setEditName(e.target.value); autoSaveTemplate(); }}
                        placeholder={t("reports.config.newPresetName")}
                        className="text-sm h-7 flex-1"
                      />
                      <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                        <button
                          onClick={() => setTemplateViewMode("edit")}
                          className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-sm transition-colors ${
                            templateViewMode === "edit"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>{t("reports.edit")}</span>
                        </button>
                        <button
                          onClick={() => setTemplateViewMode("preview")}
                          className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-sm transition-colors ${
                            templateViewMode === "preview"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Eye className="h-3 w-3" />
                          <span>{t("reports.preview")}</span>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {templateViewMode === "edit" ? (
                        <MarkdownEditor
                          value={editPrompt}
                          onChange={(v) => { setEditPrompt(v); autoSaveTemplate(); }}
                          placeholder={t("reports.config.editPrompt")}
                          className="h-full"
                          variant="bordered"
                        />
                      ) : (
                        <div className="h-full overflow-auto border rounded-md bg-card p-4">
                          <MarkdownPreview content={editPrompt} />
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                    {t("reports.config.editPrompt")}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Generate Sheet */}
        <Sheet open={genDialogOpen} onOpenChange={(open) => {
          setGenDialogOpen(open);
          if (!open) {
            // Reset generation state when Sheet closes
            setSpec(null);
            setGeneratedReport(null);
            setGenError(null);
            setSpecPhase(null);
            setStreamingText("");
            setReasoningText("");
          }
        }}>
          <SheetContent side="right" className="w-full max-w-md sm:max-w-lg flex flex-col overflow-hidden p-0 gap-0">
            {isSelectingFiles ? (
              /* State: File selection — show cached files, user confirms */
              <div className="flex-1 flex flex-col overflow-hidden">
                <SheetHeader className="px-6 pt-6 pb-2">
                  <SheetTitle>{t("reports.generate.dialogTitle")}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-auto px-6 pb-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("reports.generate.selectFilesHint")}
                  </p>
                  <div className="space-y-1">
                    {cachedLogFiles.map((file) => (
                      <label
                        key={file.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent/50 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFileIds.has(file.id)}
                          onChange={() => {
                            setSelectedFileIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(file.id)) next.delete(file.id);
                              else next.add(file.id);
                              return next;
                            });
                          }}
                          className="rounded border-input shrink-0"
                        />
                        <span className="text-xs text-muted-foreground w-24 shrink-0">{file.id}</span>
                        <span className="flex-1 truncate text-xs">{file.summary}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="border-t p-4 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSpecPhase(null);
                    }}
                  >
                    {t("reports.generate.regenerate")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={selectedFileIds.size === 0}
                    onClick={() => {
                      handleConfirmLogs(Array.from(selectedFileIds));
                    }}
                  >
                    {t("reports.generate.confirmSelection")}
                  </Button>
                </div>
              </div>
            ) : isGenIdle ? (
              /* State 1: Config — not generating, no results */
              <>
                <SheetHeader className="px-6 pt-6 pb-2">
                  <SheetTitle>{t("reports.generate.dialogTitle")}</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 px-6 pb-6">
                  {/* Template + Model on same row */}
                  <div className="flex items-center gap-2">
                    {/* Template selector */}
                    <Select
                      value={config.selected_report_preset || ""}
                      onValueChange={(v) => {
                        if (v === "__manage__") {
                          setManageDialogOpen(true);
                          return;
                        }
                        persistConfig({ selected_report_preset: v });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder={t("reports.generate.templateLabel")} />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((tmpl) => (
                          <SelectItem key={tmpl.filename} value={tmpl.filename} className="text-xs">
                            {tmpl.name}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        <SelectItem value="__manage__" className="text-xs text-muted-foreground">
                          {t("reports.config.managePresets")}
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Model selector */}
                    <Select value={currentModelValue} onValueChange={handleModelSelectChange}>
                      <SelectTrigger className="h-8 text-xs w-auto min-w-[100px]" disabled={!aiConfigured}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(AI_PROVIDERS).map(([key, provider], groupIdx) => {
                          const models = provider.models;
                          if (models.length === 0) return null;
                          return (
                            <Fragment key={key}>
                              {groupIdx > 0 && <SelectSeparator />}
                              <SelectGroup>
                                <SelectLabel className="text-xs text-muted-foreground">{provider.name}</SelectLabel>
                                {models.map((m) => (
                                  <SelectItem key={`${key}::${m}`} value={`${key}::${m}`} className="text-xs">
                                    {m}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </Fragment>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Start button */}
                  <Button
                    onClick={() => handleGenerate()}
                    disabled={!aiConfigured || templates.length === 0}
                    className="w-full"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {t("reports.generate.startGenerate")}
                  </Button>

                  {templates.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center">{t("reports.generate.noTemplates")}</p>
                  )}
                </div>
              </>
            ) : generating ? (
              /* State 2: Generating — show streaming/rendering */
              <div className="flex-1 flex flex-col overflow-hidden">
                <SheetHeader className="px-6 pt-6 pb-2">
                  <SheetTitle>{t("reports.generate.dialogTitle")}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-auto px-6 pb-6">
                  {genError && !generating ? (
                    <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-md p-3">
                      {genError}
                    </div>
                  ) : null}

                  {spec ? (
                    <div className="space-y-4">
                      {/* Show conversational text above the rendered spec */}
                      {streamingText && (
                        <div className="text-sm text-muted-foreground">
                          <MarkdownPreview content={streamingText} />
                        </div>
                      )}
                      <RenderErrorBoundary>
                        <StateProvider initialState={{}}>
                          <VisibilityProvider>
                            <ActionProvider
                              handlers={{
                                save_report: async () => { await handleSaveReport(); },
                                regenerate: async () => { handleGenerate("\u8bf7\u6839\u636e\u4e4b\u524d\u7684\u65e5\u5fd7\u5185\u5bb9\u91cd\u65b0\u751f\u6210\u62a5\u544a\uff0c\u5c1d\u8bd5\u6539\u8fdb\u683c\u5f0f\u548c\u5185\u5bb9\u3002"); },
                                answer_clarify: async (params) => {
                                  const answer = (params as { answer?: string })?.answer || "";
                                  handleGenerate(answer);
                                },
                                confirm_logs: async (params) => {
                                  const selectedIds = (params as { selected_ids?: string[] })?.selected_ids || [];
                                  handleConfirmLogs(selectedIds);
                                },
                              }}
                            >
                              <Renderer spec={spec} registry={registry} loading={generating} />
                            </ActionProvider>
                          </VisibilityProvider>
                        </StateProvider>
                      </RenderErrorBoundary>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Thinking phase */}
                      {reasoningText && !streamingText ? (
                        <>
                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{t("reports.generate.thinking")}</span>
                          </div>
                          <details className="text-xs text-muted-foreground/60">
                            <summary className="cursor-pointer select-none">{t("reports.generate.viewThinking")}</summary>
                            <pre className="mt-2 whitespace-pre-wrap break-words max-h-64 overflow-auto bg-muted/30 rounded p-3 text-xs">
                              {reasoningText}
                            </pre>
                          </details>
                        </>
                      ) : streamingText ? (
                        <>
                          {/* Conversational text before spec is ready */}
                          <div className="text-sm text-muted-foreground">
                            <MarkdownPreview content={streamingText} />
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{t("reports.generate.buildingReport")}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{t("reports.generate.generating")}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : isGenComplete || genError ? (
              /* State 3: Complete or error — show result + actions */
              <div className="flex-1 flex flex-col overflow-hidden">
                <SheetHeader className="px-6 pt-6 pb-2">
                  <SheetTitle>{t("reports.generate.dialogTitle")}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-auto px-6 pb-6">
                  {genError && (
                    <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-md p-3">
                      {genError}
                    </div>
                  )}

                  {spec ? (
                    <div className="space-y-4">
                      {streamingText && (
                        <div className="text-sm text-muted-foreground">
                          <MarkdownPreview content={streamingText} />
                        </div>
                      )}
                      <RenderErrorBoundary>
                        <StateProvider initialState={{}}>
                          <VisibilityProvider>
                            <ActionProvider
                              handlers={{
                                save_report: async () => { await handleSaveReport(); },
                                regenerate: async () => { handleGenerate("\u8bf7\u6839\u636e\u4e4b\u524d\u7684\u65e5\u5fd7\u5185\u5bb9\u91cd\u65b0\u751f\u6210\u62a5\u544a\uff0c\u5c1d\u8bd5\u6539\u8fdb\u683c\u5f0f\u548c\u5185\u5bb9\u3002"); },
                                answer_clarify: async (params) => {
                                  const answer = (params as { answer?: string })?.answer || "";
                                  handleGenerate(answer);
                                },
                                confirm_logs: async (params) => {
                                  const selectedIds = (params as { selected_ids?: string[] })?.selected_ids || [];
                                  handleConfirmLogs(selectedIds);
                                },
                              }}
                            >
                              <Renderer spec={spec} registry={registry} loading={false} />
                            </ActionProvider>
                          </VisibilityProvider>
                        </StateProvider>
                      </RenderErrorBoundary>
                    </div>
                  ) : generatedReport ? (
                    <div className="space-y-3">
                      <MarkdownPreview content={generatedReport} />
                    </div>
                  ) : null}
                </div>
                {specPhase === "generation" && !spec && generatedReport && (
                  <div className="border-t p-4 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerate("\u8bf7\u6839\u636e\u4e4b\u524d\u7684\u65e5\u5fd7\u5185\u5bb9\u91cd\u65b0\u751f\u6210\u62a5\u544a\uff0c\u5c1d\u8bd5\u6539\u8fdb\u683c\u5f0f\u548c\u5185\u5bb9\u3002")}
                    >
                      {t("reports.generate.regenerate")}
                    </Button>
                    <Button size="sm" onClick={handleSaveReport}>
                      {t("reports.generate.saveReport")}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </SheetContent>
        </Sheet>

        {/* Main content — report viewing/editing only */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {selectedReport ? (
            /* Existing report edit/preview */
            <>
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {selectedReport.replace(/\.md$/, "")}
                </h3>
                <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                  <button
                    onClick={() => setViewMode("edit")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                      viewMode === "edit"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>{t("reports.edit")}</span>
                  </button>
                  <button
                    onClick={() => setViewMode("preview")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                      viewMode === "preview"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
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
                  <MarkdownEditor
                    value={content}
                    onChange={handleContentChange}
                    className="h-full"
                  />
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
    </div>
  );
}
