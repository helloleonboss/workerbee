import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FileText, Plus, Settings as SettingsIcon, Check, Edit3, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
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
  generateReport,
  listTemplates,
  readTemplate,
  writeTemplate,
  deleteTemplate,
  listLogs,
  detectAgents,
  getConfig,
  saveConfig,
  type DetectedAgent,
  type AppConfig,
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

  // Generator state
  const [showGenerator, setShowGenerator] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  // Source files selection
  const [logs, setLogs] = useState<string[]>([]);
  const [allSourceReports, setAllSourceReports] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());

  // Agent state
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([]);
  const [agentCommand, setAgentCommand] = useState("");
  const [useCustomAgent, setUseCustomAgent] = useState(false);

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
    loadAgents();
    loadConfig();
  }, []);

  // Auto-expand generator if no reports exist
  useEffect(() => {
    if (reports.length === 0) {
      setShowGenerator(true);
    }
  }, [reports.length]);

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

  async function loadAgents() {
    try {
      const agents = await detectAgents();
      setDetectedAgents(agents);
    } catch (e) {
      console.error("Failed to detect agents:", e);
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

  function toggleSource(source: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }

  async function handleGenerate() {
    if (selectedSources.size === 0) {
      setGenError(t("reports.selectSourceHint"));
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const sourceFiles = Array.from(selectedSources);
      const filename = await generateReport(sourceFiles, selectedTemplate);
      await loadReports();
      await loadReport(filename);
      await loadSourceFiles();
      setSelectedSources(new Set());
      setShowGenerator(false);
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Agent handling
  const agentSelectValue = (() => {
    if (useCustomAgent) return "__custom__";
    const baseCmd = agentCommand.split(/\s+/)[0];
    if (!baseCmd) return "";
    if (detectedAgents.some((a) => a.available && a.command === baseCmd)) return baseCmd;
    return "__custom__";
  })();

  const handleAgentChange = useCallback(
    async (val: string) => {
      if (val === "__custom__") {
        setUseCustomAgent(true);
        setAgentCommand("");
      } else {
        setUseCustomAgent(false);
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
      }
    },
    []
  );

  const handleCustomAgentChange = useCallback(
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

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r bg-muted/20 flex flex-col">
        {/* Reports header */}
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
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
        </div>

        {/* Generator form */}
        {showGenerator && (
          <div className="p-3 border-b space-y-3 bg-muted/30">
            {/* Source files selection — grouped: logs + reports */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("reports.sourceFiles")}
              </label>
              <ScrollArea className="h-40 rounded border bg-background">
                {/* Logs group */}
                {logs.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/50 sticky top-0">
                      {t("reports.logsGroup")}
                    </div>
                    {logs.map((date) => {
                      const key = `logs/${date}`;
                      const checked = selectedSources.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => toggleSource(key)}
                          className={`w-full text-left px-2 py-1 text-xs flex items-center gap-1.5 hover:bg-accent transition-colors ${
                            checked ? "bg-accent/50" : ""
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${checked ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                            {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          <span className="truncate">{date}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Reports group */}
                {allSourceReports.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/50 sticky top-0">
                      {t("reports.reportsGroup")}
                    </div>
                    {allSourceReports.map((name) => {
                      const key = `reports/${name}`;
                      const checked = selectedSources.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => toggleSource(key)}
                          className={`w-full text-left px-2 py-1 text-xs flex items-center gap-1.5 hover:bg-accent transition-colors ${
                            checked ? "bg-accent/50" : ""
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${checked ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                            {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          <span className="truncate">{displayName(name)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {logs.length === 0 && allSourceReports.length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    {t("reports.noSourceFiles")}
                  </div>
                )}
              </ScrollArea>
              {selectedSources.size > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {t("reports.selectedCount", { count: String(selectedSources.size) })}
                </p>
              )}
            </div>

            {/* Template selector + manage button */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  {t("reports.selectTemplate")}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={openTemplateManager}
                  title={t("reports.manageTemplates")}
                >
                  <SettingsIcon className="h-3 w-3" />
                </Button>
              </div>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger className="text-xs h-7">
                  <SelectValue placeholder={t("reports.noTemplate")} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tmpl) => (
                    <SelectItem key={tmpl} value={tmpl}>
                      {tmpl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agent selector */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("reports.agent")}
              </label>
              <Select value={agentSelectValue} onValueChange={handleAgentChange}>
                <SelectTrigger className="text-xs h-7">
                  <SelectValue placeholder={t("reports.selectAgent")} />
                </SelectTrigger>
                <SelectContent>
                  {detectedAgents.filter((a) => a.available).map((agent) => (
                    <SelectItem key={agent.command} value={agent.command}>
                      {agent.name}
                    </SelectItem>
                  ))}
                  {detectedAgents.filter((a) => a.available).length > 0 && (
                    <SelectItem value="__separator__" disabled>
                      ──────────
                    </SelectItem>
                  )}
                  <SelectItem value="__custom__">
                    {t("reports.customAgent")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom agent input */}
            {useCustomAgent && (
              <Input
                value={agentCommand}
                onChange={(e) => handleCustomAgentChange(e.target.value)}
                placeholder={t("reports.agentPlaceholder")}
                className="text-xs h-7"
              />
            )}

            {/* Error */}
            {genError && (
              <p className="text-xs text-destructive">{genError}</p>
            )}

            {/* Generate button */}
            <Button
              size="sm"
              className="w-full"
              onClick={handleGenerate}
              disabled={generating || selectedSources.size === 0}
            >
              {generating ? t("reports.generating") : t("reports.generate")}
            </Button>
          </div>
        )}

        {/* Reports list */}
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
                    filename === selectedReport ? "bg-accent font-medium" : ""
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
            {/* Filename header with view mode toggle */}
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {displayName(selectedReport)}
              </h3>
              <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                <button
                  onClick={() => setViewMode("edit")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                    viewMode === "edit"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={t("reports.editMode")}
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
                  title={t("reports.previewMode")}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{t("reports.preview")}</span>
                </button>
              </div>
            </div>

            {/* Report content */}
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
                <MarkdownPreview
                  content={content}
                  className="h-full"
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

      {/* Template Manager Dialog */}
      <Dialog open={showTemplateManager} onOpenChange={setShowTemplateManager}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t("reports.templateManager")}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-4 min-h-[400px]">
            {/* Template list */}
            <div className="w-40 border-r pr-4 flex flex-col">
              <Button
                variant="ghost"
                size="sm"
                className="mb-2"
                onClick={createNewTemplate}
              >
                <Plus className="h-4 w-4 mr-1" />
                {t("reports.newTemplate")}
              </Button>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {tmplList.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {t("templates.noTemplates")}
                    </div>
                  ) : (
                    tmplList.map((filename) => (
                      <button
                        key={filename}
                        onClick={() => loadTmpl(filename)}
                        className={`w-full text-left px-2 py-1.5 text-xs hover:bg-accent transition-colors truncate rounded ${
                          filename === selectedTmpl ? "bg-accent font-medium" : ""
                        }`}
                      >
                        {displayName(filename)}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Template editor */}
            <div className="flex-1 flex flex-col">
              {selectedTmpl ? (
                <>
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
                        className="text-sm font-medium cursor-text"
                        onClick={startTmplRename}
                        title={t("reports.clickToRename")}
                      >
                        {displayName(selectedTmpl)}
                      </h4>
                    )}
                  </div>

                  {/* Template content */}
                  <div className="flex-1">
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
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <FileText className="w-8 h-8 opacity-30 mb-2" />
                  <p className="text-xs">{t("templates.selectTemplate")}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
