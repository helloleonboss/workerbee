import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FileText, Edit3, Eye, Check, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  listReports,
  readReport,
  writeReport,
  listTemplates,
  readTemplate,
  writeTemplate,
  deleteTemplate,
  listLogs,
  readLog,
  executePrompt,
  getConfig,
  saveConfig,
  type AppConfig,
} from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { t } from "../lib/i18n";
import { assemblePrompt, FALLBACK_DEFAULT_TEMPLATE } from "../lib/prompt";

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
  const [appMode, setAppMode] = useState<"generate" | "view">("generate");

  // Generator state
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);

  // Source files selection
  const [logs, setLogs] = useState<string[]>([]);
  const [allSourceReports, setAllSourceReports] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [sourceContentsCache, setSourceContentsCache] = useState<Map<string, string>>(new Map());
  const [assembledPrompt, setAssembledPrompt] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [defaultTemplate, setDefaultTemplate] = useState(FALLBACK_DEFAULT_TEMPLATE);

  // Agent state
  const [agentCommand, setAgentCommand] = useState("");

  // Template manager Dialog state
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [tmplList, setTmplList] = useState<string[]>([]);
  const [selectedTmpl, setSelectedTmpl] = useState<string | null>(null);
  const [tmplContent, setTmplContent] = useState("");
  const [tmplLoading, setTmplLoading] = useState(false);
  const [editingTmplName, setEditingTmplName] = useState(false);
  const [tmplNameInput, setTmplNameInput] = useState("");

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef("");
  const tmplSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tmplOriginalContentRef = useRef("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const configRef = useRef<AppConfig | null>(null);

  // Load everything on mount
  useEffect(() => {
    loadReports();
    loadSourceFiles();
    loadTemplates();
    loadConfig();
  }, []);

  // Auto-expand generator if no reports exist
  useEffect(() => {
    if (reports.length === 0) {
      setAppMode("generate");
    }
  }, [reports.length]);

  // Load default template on mount
  useEffect(() => {
    async function loadDefaultTemplate() {
      try {
        const content = await readTemplate("default");
        setDefaultTemplate(content);
      } catch (e) {
        console.error("Failed to load default template:", e);
        setDefaultTemplate(FALLBACK_DEFAULT_TEMPLATE);
      }
    }
    loadDefaultTemplate();
  }, []);

  // Re-assemble prompt when sources or template changes (with debounce)
  useEffect(() => {
    if (promptEdited) return; // Don't auto-update if user has manually edited

    const timer = setTimeout(() => {
      const templateContent = selectedTmpl ? tmplContent : "";
      const sourcesArray = Array.from(selectedSources)
        .filter((key) => sourceContentsCache.has(key))
        .map((key) => [key, sourceContentsCache.get(key)!] as [string, string]);

      const assembled = assemblePrompt(defaultTemplate, templateContent, sourcesArray);
      setAssembledPrompt(assembled);
    }, 200);

    return () => clearTimeout(timer);
  }, [selectedSources, selectedTmpl, tmplContent, sourceContentsCache, defaultTemplate, promptEdited]);

  async function loadConfig() {
    try {
      const cfg = await getConfig();
      configRef.current = cfg;
      if (cfg?.agent_command) {
        setAgentCommand(cfg.agent_command);
      }
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  }

  async function loadTemplates() {
    try {
      const list = await listTemplates();
      setTemplates(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }

  async function loadSourceFiles() {
    try {
      const [logList, reportList] = await Promise.all([listLogs(), listReports()]);
      setLogs(logList.sort().reverse());
      setAllSourceReports(reportList.sort().reverse());
    } catch (e) {
      console.error("Failed to load source files:", e);
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

  async function toggleSource(source: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
        setExpandedSources((prev) => { const n = new Set(prev); n.delete(source); return n; });
      } else {
        next.add(source);
        // Load content if not cached
        if (!sourceContentsCache.has(source)) {
          const [subdir, name] = source.split("/");
          readContent(subdir, name).then((content) => {
            setSourceContentsCache((prev) => new Map(prev).set(source, content));
          });
        }
        // Auto-expand when selected
        setExpandedSources((prev) => new Set(prev).add(source));
      }
      return next;
    });
  }

  async function readContent(subdir: string, name: string): Promise<string> {
    if (subdir === "logs") {
      return await readLog(name);
    } else {
      return await readReport(name);
    }
  }

  async function handleSelectAll() {
    const allKeys = [...logs.map((d) => `logs/${d}`), ...allSourceReports.map((r) => `reports/${r}`)];
    setSelectedSources(new Set(allKeys));
    // Load all file contents
    for (const key of allKeys) {
      if (!sourceContentsCache.has(key)) {
        const [subdir, name] = key.split("/");
        const content = await readContent(subdir, name);
        setSourceContentsCache((prev) => new Map(prev).set(key, content));
      }
    }
    setExpandedSources(new Set(allKeys));
  }

  function handleDeselectAll() {
    setSelectedSources(new Set());
    setExpandedSources(new Set());
  }

  function handlePromptContentChange(newContent: string) {
    setAssembledPrompt(newContent);
    if (!promptEdited) {
      setPromptEdited(true);
    }
  }

  function handleResetPrompt() {
    setPromptEdited(false);
    // The useEffect will re-assemble automatically when promptEdited becomes false
  }

  async function handleGenerate() {
    if (selectedSources.size === 0) {
      setGenError(t("reports.selectSourceHint"));
      return;
    }
    if (!agentCommand) {
      setGenError(t("reports.noAgentCommand"));
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      await executePrompt(assembledPrompt);
      // Success feedback - briefly then reset
      setTimeout(() => {
        setGenError(null);
      }, 2000);
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  const handleAgentCommandChange = useCallback(
    async (val: string) => {
      setAgentCommand(val);
      if (configRef.current) {
        const newConfig: AppConfig = { ...configRef.current, agent_command: val };
        try {
          await saveConfig(newConfig);
          configRef.current = newConfig;
        } catch (e) {
          console.error("Failed to save agent config:", e);
        }
      }
    },
    []
  );

  // Template manager Dialog functions
  async function loadTemplateManagerTemplates() {
    try {
      const list = await listTemplates();
      setTmplList(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }

  async function loadTmpl(filename: string) {
    setTmplLoading(true);
    try {
      const text = await readTemplate(filename);
      setSelectedTmpl(filename);
      setTmplContent(text);
      tmplOriginalContentRef.current = text;
      setEditingTmplName(false);
    } catch (e) {
      console.error("Failed to load template:", e);
    } finally {
      setTmplLoading(false);
    }
  }

  function handleTmplContentChange(newContent: string) {
    setTmplContent(newContent);

    if (tmplSaveTimeoutRef.current) {
      clearTimeout(tmplSaveTimeoutRef.current);
    }
    tmplSaveTimeoutRef.current = setTimeout(async () => {
      if (!selectedTmpl) return;
      if (newContent !== tmplOriginalContentRef.current) {
        try {
          await writeTemplate(selectedTmpl, newContent);
          tmplOriginalContentRef.current = newContent;
          if (!newContent.trim()) {
            await deleteTemplate(selectedTmpl);
            setSelectedTmpl(null);
            setTmplContent("");
            await loadTemplateManagerTemplates();
            await loadTemplates();
          }
          onRefresh?.();
        } catch (e) {
          console.error("Failed to save template:", e);
        }
      }
    }, 300);
  }

  async function createNewTemplate() {
    const base = t("templates.newName");
    let name = base;
    let counter = 2;
    while (tmplList.includes(name)) {
      name = `${base}-${counter}`;
      counter++;
    }

    try {
      await writeTemplate(name, "");
      await loadTemplateManagerTemplates();
      await loadTemplates();
      await loadTmpl(name);
    } catch (e) {
      console.error("Failed to create template:", e);
    }
  }

  const startTmplRename = useCallback(() => {
    if (!selectedTmpl) return;
    setTmplNameInput(displayName(selectedTmpl));
    setEditingTmplName(true);
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [selectedTmpl]);

  const finishTmplRename = useCallback(async () => {
    setEditingTmplName(false);
    if (!selectedTmpl) return;
    const newName = tmplNameInput.trim();
    if (!newName || newName === displayName(selectedTmpl)) return;

    try {
      await writeTemplate(newName, tmplContent);
      await deleteTemplate(selectedTmpl);
      setSelectedTmpl(newName);
      await loadTemplateManagerTemplates();
      await loadTemplates();
    } catch (e) {
      console.error("Failed to rename template:", e);
    }
  }, [selectedTmpl, tmplNameInput, tmplContent]);

  function displayName(filename: string): string {
    return filename.replace(/\.md$/, "");
  }

  const openTemplateManager = useCallback(async () => {
    setShowTemplateManager(true);
    await loadTemplateManagerTemplates();
  }, []);

  // Suppress unused warnings — these will be wired into the UI by subsequent tasks
  void SelectContent; void SelectItem; void SelectTrigger; void SelectValue;
  void genError;
  void templates;
  void logs;
  void allSourceReports;
  void sourceContentsCache;
  void setSourceContentsCache;
  void promptEdited;
  void setPromptEdited;
  void showTemplateManager;
  void tmplList;
  void selectedTmpl;
  void tmplContent;
  void tmplLoading;
  void editingTmplName;
  void tmplNameInput;
  void toggleSource;
  void handleGenerate;
  void handleTmplContentChange;
  void createNewTemplate;
  void startTmplRename;
  void finishTmplRename;
  void openTemplateManager;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar with mode toggle + agent command */}
      <div className="border-b p-3 flex items-center gap-4">
        <div className="flex gap-2">
          <Button variant={appMode === "generate" ? "default" : "outline"} onClick={() => setAppMode("generate")}>
            {t("reports.generateNew")}
          </Button>
          <Button variant={appMode === "view" ? "default" : "outline"} onClick={() => setAppMode("view")}>
            {t("reports.viewReports")}
          </Button>
        </div>
        <div className="flex-1 max-w-md">
          <Input
            value={agentCommand}
            onChange={(e) => { handleAgentCommandChange(e.target.value); }}
            placeholder={t("reports.agentPlaceholder")}
          />
        </div>
      </div>

      {/* Main content area - dual column */}
      <div className="flex-1 flex overflow-hidden">
        {appMode === "generate" ? (
          // Generate mode: left column (source selection + template management) + right column (prompt preview)
          <>
            <div className="w-2/5 border-r overflow-hidden flex flex-col">
              {/* Section header */}
              <div className="p-3 border-b flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  {t("reports.selectSources")}
                </label>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleSelectAll}>
                    {t("reports.selectAll")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleDeselectAll}>
                    {t("reports.deselectAll")}
                  </Button>
                </div>
              </div>

              {/* Source files list */}
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {/* Logs group */}
                  {logs.length > 0 && (
                    <div>
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/50 rounded">
                        {t("reports.logsGroup")}
                      </div>
                      {logs.map((date) => {
                        const key = `logs/${date}`;
                        const content = sourceContentsCache.get(key);
                        const isExpanded = expandedSources.has(key);
                        return (
                          <div key={key} className="border rounded overflow-hidden">
                            <button
                              onClick={() => toggleSource(key)}
                              className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-accent transition-colors"
                            >
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                selectedSources.has(key) ? "bg-primary border-primary" : "border-muted-foreground/30"
                              }`}>
                                {selectedSources.has(key) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </span>
                              <span className="truncate flex-1">{date}</span>
                              {selectedSources.has(key) && (
                                <span className="text-[10px] text-muted-foreground">
                                  {isExpanded ? "▼" : "▶"}
                                </span>
                              )}
                            </button>
                            {selectedSources.has(key) && isExpanded && content !== undefined && (
                              <div className="px-2 py-2 text-xs bg-muted/20 border-t max-h-40 overflow-y-auto">
                                <pre className="whitespace-pre-wrap break-words text-muted-foreground font-mono">
                                  {content.length > 300 ? content.slice(0, 300) + "..." : content}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reports group */}
                  {allSourceReports.length > 0 && (
                    <div>
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/50 rounded">
                        {t("reports.reportsGroup")}
                      </div>
                      {allSourceReports.map((name) => {
                        const key = `reports/${name}`;
                        const content = sourceContentsCache.get(key);
                        const isExpanded = expandedSources.has(key);
                        return (
                          <div key={key} className="border rounded overflow-hidden">
                            <button
                              onClick={() => toggleSource(key)}
                              className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-accent transition-colors"
                            >
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                selectedSources.has(key) ? "bg-primary border-primary" : "border-muted-foreground/30"
                              }`}>
                                {selectedSources.has(key) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </span>
                              <span className="truncate flex-1">{displayName(name)}</span>
                              {selectedSources.has(key) && (
                                <span className="text-[10px] text-muted-foreground">
                                  {isExpanded ? "▼" : "▶"}
                                </span>
                              )}
                            </button>
                            {selectedSources.has(key) && isExpanded && content !== undefined && (
                              <div className="px-2 py-2 text-xs bg-muted/20 border-t max-h-40 overflow-y-auto">
                                <pre className="whitespace-pre-wrap break-words text-muted-foreground font-mono">
                                  {content.length > 300 ? content.slice(0, 300) + "..." : content}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Empty state */}
                  {logs.length === 0 && allSourceReports.length === 0 && (
                    <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                      {t("reports.noSourceFiles")}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Selected count */}
              {selectedSources.size > 0 && (
                <div className="p-2 border-t text-[10px] text-muted-foreground text-center">
                  {t("reports.selectedCount", { count: String(selectedSources.size) })}
                </div>
              )}

              {/* Template manager section */}
              <div className="border-t">
                <div className="p-3 border-b flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    {t("reports.selectPrompt")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={createNewTemplate}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {t("reports.createPrompt")}
                  </Button>
                </div>

                {/* Template selector */}
                <div className="p-2">
                  <Select value={selectedTmpl || ""} onValueChange={loadTmpl}>
                    <SelectTrigger className="text-xs h-7">
                      <SelectValue placeholder={t("reports.noTemplate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((tmpl) => (
                        <SelectItem key={tmpl} value={tmpl}>
                          {tmpl === "default.md" ? `${displayName(tmpl)} (${t("reports.systemTemplate")})` : displayName(tmpl)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Inline template editor */}
                {selectedTmpl ? (
                  <div className="p-2 border-t flex-1 flex flex-col min-h-0">
                    {/* Template name header */}
                    <div className="mb-2">
                      {editingTmplName ? (
                        <input
                          ref={nameInputRef}
                          value={tmplNameInput}
                          onChange={(e) => setTmplNameInput(e.target.value)}
                          onBlur={finishTmplRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              finishTmplRename();
                            }
                            if (e.key === "Escape") {
                              setEditingTmplName(false);
                            }
                          }}
                          className="text-sm font-medium bg-transparent outline-none border-0 p-0 w-full caret-foreground"
                        />
                      ) : (
                        <h4
                          className="text-sm font-medium cursor-text flex items-center gap-1"
                          onClick={startTmplRename}
                          title={t("reports.clickToRename")}
                        >
                          {displayName(selectedTmpl)}
                          {selectedTmpl === "default.md" && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              ({t("reports.systemTemplate")})
                            </span>
                          )}
                        </h4>
                      )}
                    </div>

                    {/* Template content */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {tmplLoading ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                          {t("app.loading")}
                        </div>
                      ) : (
                        <MarkdownEditor
                          value={tmplContent}
                          onChange={handleTmplContentChange}
                          className="h-full"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    {t("templates.selectTemplate")}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {/* Header bar */}
              <div className="px-4 py-2 border-b flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  {t("reports.promptPreview")}
                  {promptEdited && (
                    <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded">
                      {t("reports.promptModified")}
                    </span>
                  )}
                </h3>
                {promptEdited && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={handleResetPrompt}
                    title={t("reports.resetPrompt")}
                  >
                    {t("reports.resetPrompt")}
                  </Button>
                )}
              </div>

              {/* Prompt editor */}
              <div className="flex-1 overflow-hidden p-4">
                {selectedSources.size === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    {t("reports.emptyPromptPreview")}
                  </div>
                ) : (
                  <MarkdownEditor
                    value={assembledPrompt}
                    onChange={handlePromptContentChange}
                    className="h-full"
                  />
                )}
              </div>

              {/* Submit button */}
              {selectedSources.size > 0 && (
                <div className="p-3 border-t">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleGenerate}
                    disabled={generating || selectedSources.size === 0 || !agentCommand}
                  >
                    {generating ? t("reports.generating") : t("reports.submitPrompt")}
                  </Button>
                  {genError && (
                    <p className="text-xs text-destructive mt-2 text-center">{genError}</p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          // View mode: reports list + report content viewer
          <>
            <div className="w-56 border-r overflow-hidden flex flex-col">
              {/* Reports list */}
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
                        onClick={() => { setSelectedReport(filename); loadReport(filename); }}
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
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Report content viewer */}
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
          </>
        )}
      </div>
    </div>
  );
}
