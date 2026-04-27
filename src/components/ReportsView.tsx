import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { FileText, Plus, Trash2 } from "lucide-react";
import {
  listReports,
  readReport,
  writeReport,
  listTemplates,
  readTemplate,
  writeTemplate,
  deleteTemplate,
  type AppConfig,
  type TemplateInfo,
} from "../lib/api";
import { RichTextEditor } from "./RichTextEditor";
import { t } from "../lib/i18n";

type SidebarTab = "reports" | "templates";

interface ReportsViewProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onRefresh?: () => void;
}

export function ReportsView({ config, onRefresh }: ReportsViewProps) {
  // ── Shared state ──
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("reports");

  // ── Reports state ──
  const [reports, setReports] = useState<string[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [reportContent, setReportContent] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const reportSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportOriginalRef = useRef("");

  // ── Templates state ──
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDateRange, setTemplateDateRange] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);
  const templateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load lists on mount ──

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
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }

  // ── Report handlers ──

  async function handleSelectReport(filename: string) {
    setReportLoading(true);
    try {
      const text = await readReport(filename);
      setSelectedReport(filename);
      setReportContent(text);
      reportOriginalRef.current = text;
    } catch (e) {
      console.error("Failed to load report:", e);
    } finally {
      setReportLoading(false);
    }
  }

  function handleReportChange(newContent: string) {
    setReportContent(newContent);
    if (reportSaveTimer.current) clearTimeout(reportSaveTimer.current);
    reportSaveTimer.current = setTimeout(async () => {
      if (selectedReport && newContent !== reportOriginalRef.current) {
        try {
          await writeReport(selectedReport, newContent);
          reportOriginalRef.current = newContent;
          onRefresh?.();
        } catch (e) {
          console.error("Failed to save report:", e);
        }
      }
    }, 600);
  }

  // ── Template handlers ──

  async function handleSelectTemplate(filename: string) {
    setTemplateLoading(true);
    try {
      const tmpl = await readTemplate(filename);
      setSelectedTemplate(filename);
      setTemplateName(tmpl.name);
      setTemplateDateRange(tmpl.date_range ?? "");
      setTemplatePrompt(tmpl.prompt);
    } catch (e) {
      console.error("Failed to load template:", e);
    } finally {
      setTemplateLoading(false);
    }
  }

  function scheduleTemplateSave() {
    if (templateSaveTimer.current) clearTimeout(templateSaveTimer.current);
    templateSaveTimer.current = setTimeout(async () => {
      if (!selectedTemplate || !templateName.trim()) return;
      try {
        await writeTemplate(
          selectedTemplate,
          templateName.trim(),
          templateDateRange.trim() || null,
          templatePrompt,
        );
        loadTemplates();
      } catch (e) {
        console.error("Failed to save template:", e);
      }
    }, 400);
  }

  function handleTemplateNameChange(name: string) {
    setTemplateName(name);
    scheduleTemplateSave();
  }

  function handleTemplateDateRangeChange(dr: string) {
    setTemplateDateRange(dr);
    scheduleTemplateSave();
  }

  function handleTemplatePromptChange(prompt: string) {
    setTemplatePrompt(prompt);
    scheduleTemplateSave();
  }

  async function handleNewTemplate() {
    const filename = `template-${Date.now()}`;
    const name = t("templates.newName");
    try {
      await writeTemplate(filename, name, null, "");
      await loadTemplates();
      handleSelectTemplate(filename);
    } catch (e) {
      console.error("Failed to create template:", e);
    }
  }

  async function handleDeleteTemplate(filename: string) {
    try {
      await deleteTemplate(filename);
      if (selectedTemplate === filename) {
        setSelectedTemplate(null);
        setTemplateName("");
        setTemplateDateRange("");
        setTemplatePrompt("");
      }
      loadTemplates();
    } catch (e) {
      console.error("Failed to delete template:", e);
    }
  }

  // ── Render ──

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r overflow-hidden flex flex-col">
        {/* Tab switcher */}
        <div className="flex border-b">
          <button
            onClick={() => setSidebarTab("reports")}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === "reports"
                ? "text-foreground border-b-2 border-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("reports.title")}
          </button>
          <button
            onClick={() => setSidebarTab("templates")}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === "templates"
                ? "text-foreground border-b-2 border-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("templates.title")}
          </button>
        </div>

        {/* List */}
        <ScrollArea className="flex-1">
          {sidebarTab === "reports" ? (
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
          ) : (
            <div className="py-1">
              <div className="px-2 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNewTemplate}
                  className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("templates.newTemplate")}
                </Button>
              </div>
              {templates.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {t("templates.noTemplates")}
                </div>
              ) : (
                templates.map((tmpl) => (
                  <div
                    key={tmpl.filename}
                    className={`group flex items-center ${
                      tmpl.filename === selectedTemplate ? "bg-accent" : ""
                    }`}
                  >
                    <button
                      onClick={() => handleSelectTemplate(tmpl.filename)}
                      className="flex-1 text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate"
                    >
                      {tmpl.name || tmpl.filename}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTemplate(tmpl.filename);
                      }}
                      className="px-2 py-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {sidebarTab === "reports" ? (
          selectedReport ? (
            <>
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-medium">
                  {selectedReport.replace(/\.md$/, "")}
                </h3>
              </div>
              <div className="flex-1 overflow-hidden">
                {reportLoading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    {t("app.loading")}
                  </div>
                ) : (
                  <RichTextEditor
                    content={reportContent}
                    storagePath={config.storage_path}
                    onChange={handleReportChange}
                    className="h-full p-4"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="w-10 h-10 opacity-30 mb-2" />
              <p className="text-sm">{t("reports.selectReport")}</p>
            </div>
          )
        ) : selectedTemplate ? (
          <>
            <div className="px-4 py-3 border-b space-y-2">
              {templateLoading ? (
                <div className="text-sm text-muted-foreground">{t("app.loading")}</div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <input
                      value={templateName}
                      onChange={(e) => handleTemplateNameChange(e.target.value)}
                      placeholder={t("templates.clickToRename")}
                      className="text-sm font-medium bg-transparent outline-none border-0 p-0 flex-1 caret-foreground placeholder:text-muted-foreground"
                    />
                    <select
                      value={templateDateRange}
                      onChange={(e) => handleTemplateDateRangeChange(e.target.value)}
                      className="text-xs bg-muted rounded px-2 py-1 outline-none border-0 text-muted-foreground"
                    >
                      <option value="">{t("reports.generate.allLogs")}</option>
                      <option value="today">日报</option>
                      <option value="week">周报</option>
                      <option value="month">月报</option>
                      <option value="quarter">季报</option>
                      <option value="year">年报</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <textarea
                value={templatePrompt}
                onChange={(e) => handleTemplatePromptChange(e.target.value)}
                className="w-full h-full resize-none bg-transparent text-sm leading-relaxed p-4 outline-none border-0 caret-foreground"
                placeholder="输入提示词..."
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="w-10 h-10 opacity-30 mb-2" />
            <p className="text-sm">{t("templates.selectTemplate")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
