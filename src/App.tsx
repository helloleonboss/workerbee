import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getConfig,
  saveConfig,
  readLog,
  writeLog,
  writeReport,
  listLogs,
  DEFAULT_SHORTCUT,
  DEFAULT_SCREENSHOT_SHORTCUT,
  AI_PROVIDERS,
  type AiConfig,
  type AiProviderKey,
  type AppConfig,
  type Theme,
} from "./lib/api";
import { formatCurrentDate, parseLogEntries, type LogEntry } from "./lib/utils";
import { t, initLocale, setLocale, SUPPORTED_LOCALES } from "./lib/i18n";
import { LogViewer } from "./components/LogViewer";
import { SetupGuide } from "./components/SetupGuide";
import { ShortcutRecorder, formatShortcutForDisplay } from "./components/ShortcutRecorder";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { generateReport } from "./lib/ai/generate";
import { registry } from "./lib/ai/registry";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
} from "@json-render/react";
import type { Spec } from "@json-render/core";
import { Dialog, DialogTrigger } from "./components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/ui/sheet";
import { FolderOpen, FileText, Settings, Sun, HelpCircle, Sparkles, Loader2 } from "lucide-react";
import { ShortcutsHelpDialog } from "./components/ShortcutsHelpDialog";
import { ReportsView } from "./components/ReportsView";

type View = "today" | "logs" | "reports" | "settings";

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("today");
  const [logDates, setLogDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(formatCurrentDate());

  const [logContent, setLogContent] = useState("");
  const [theme, setTheme] = useState<Theme>("system");

  // Apply theme to document root
  useEffect(() => {
    const root = document.documentElement;
    function applyClass(isDark: boolean) {
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
    if (theme === "dark") {
      applyClass(true);
    } else if (theme === "light") {
      applyClass(false);
    } else {
      // system
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyClass(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyClass(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  // Refresh logs when main window gains focus (quick-input may have saved data)
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && config) {
        loadLogDates();
        loadLogContent(selectedDate);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [config, selectedDate]);

  // Load config on mount
  useEffect(() => {
    async function init() {
      try {
        const cfg = await getConfig();
        if (cfg && !cfg.shortcut) {
          cfg.shortcut = DEFAULT_SHORTCUT;
        }
        setConfig(cfg);
        if (cfg?.theme) {
          setTheme(cfg.theme as Theme);
        }
        initLocale(cfg?.locale);
      } catch (e) {
        console.error("Failed to load config:", e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Register global shortcut (Rust-side with_handler does the actual toggle,
  // JS-side registration is needed so the plugin recognizes the shortcut string)
  useEffect(() => {
    if (!config) return;

    const shortcut = config.shortcut || DEFAULT_SHORTCUT;
    let cancelled = false;

    async function apply() {
      if (cancelled) return;
      try {
        const mod = await import("@tauri-apps/plugin-global-shortcut");
        try { await mod.unregister(shortcut); } catch { /* not registered yet */ }
        await mod.register(shortcut, () => {
          // Rust with_handler already toggles the window.
          // This JS callback exists solely so the plugin registers the
          // shortcut string — without it the plugin won't recognize the key.
        });
        console.log("[shortcut] Registered:", shortcut);
      } catch (e) {
        console.error("[shortcut] Registration failed:", shortcut, e);
      }
    }

    apply();

    return () => {
      cancelled = true;
    };
  }, [config?.shortcut]);

  // Listen for navigate-to-settings event (from tray menu)
  useEffect(() => {
    const unlisten = listen("navigate-to-settings", () => {
      setView("settings");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    loadLogDates();
  }, [config]);

  useEffect(() => {
    if (!config) return;
    loadLogContent(selectedDate);
  }, [selectedDate, config]);

  async function loadLogDates() {
    try {
      const dates = await listLogs();
      setLogDates(dates);
    } catch (e) {
      console.error("Failed to load log dates:", e);
    }
  }

  async function loadLogContent(date: string) {
    try {
      const content = await readLog(date);
      setLogContent(content);
    } catch (e) {
      console.error("Failed to load log:", e);
      setLogContent("");
    }
  }

  const handleSetupComplete = useCallback(async (path: string) => {
    try {
      const newConfig: AppConfig = { storage_path: path, shortcut: DEFAULT_SHORTCUT };
      await saveConfig(newConfig);
      setConfig(newConfig);
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }, []);

  const handleConfigChange = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
    if (newConfig.theme) {
      setTheme(newConfig.theme as Theme);
    }
  }, []);

  const handleRefreshLogs = useCallback(() => {
    loadLogContent(selectedDate);
  }, [selectedDate]);

  const activeShortcut = config?.shortcut || DEFAULT_SHORTCUT;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">{t("app.loading")}</div>
      </div>
    );
  }

  if (!config) {
    return <SetupGuide onComplete={handleSetupComplete} />;
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="flex flex-col h-full">
          <div className="px-4 pt-3">
            <TabsList>
              <TabsTrigger
                active={view === "today"}
                onClick={() => setView("today")}
              >
                {t("nav.today")}
              </TabsTrigger>
              <TabsTrigger
                active={view === "logs"}
                onClick={() => setView("logs")}
              >
                {t("nav.logs")}
              </TabsTrigger>
              <TabsTrigger
                active={view === "reports"}
                onClick={() => setView("reports")}
              >
                {t("nav.reports")}
              </TabsTrigger>
              <TabsTrigger
                active={view === "settings"}
                onClick={() => setView("settings")}
              >
                {t("nav.settings")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent active={view === "today"} className="flex-1 overflow-hidden">
            <TodayView
              shortcutDisplay={formatShortcutForDisplay(activeShortcut)}
              shortcut={activeShortcut}
              config={config}
            />
          </TabsContent>

          <TabsContent active={view === "logs"} className="flex-1 overflow-hidden">
            <LogViewer
              dates={logDates}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              logContent={logContent}
              onRefresh={handleRefreshLogs}
            />
          </TabsContent>

          <TabsContent active={view === "reports"} className="flex-1 overflow-hidden">
            <ReportsView config={config} onConfigChange={handleConfigChange} />
          </TabsContent>

          <TabsContent active={view === "settings"} className="flex-1 min-h-0 overflow-auto flex items-center p-4">
            <div className="w-full max-w-lg">
              <SettingsView config={config} onConfigChange={handleConfigChange} />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function TodayView({
  shortcutDisplay,
  shortcut,
  config,
}: {
  shortcutDisplay: string;
  shortcut: string;
  config: AppConfig;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("hasSeenShortcutHint"));

  // Daily report generation state
  const [genSheetOpen, setGenSheetOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const dismissHint = () => {
    localStorage.setItem("hasSeenShortcutHint", "1");
    setShowHint(false);
  };

  const dateObj = new Date();
  const dateDisplay = dateObj.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const loadEntries = useCallback(async () => {
    try {
      const date = formatCurrentDate();
      const content = await readLog(date);
      setEntries(parseLogEntries(content));
    } catch (e) {
      console.error("Failed to load today's log:", e);
      setEntries([]);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Reload when window gains focus (quick-input may have saved data)
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        loadEntries();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadEntries]);

  // Sort entries by time descending (newest first)
  const sortedEntries = [...entries].sort((a, b) => b.time.localeCompare(a.time));

  const aiConfigured = !!(config.ai?.api_key);

  async function handleGenerateDailyReport() {
    if (!config.ai) {
      setGenError(t("today.noConfig"));
      setGenSheetOpen(true);
      return;
    }

    if (sortedEntries.length === 0) {
      setGenError(t("today.noEntries"));
      setGenSheetOpen(true);
      return;
    }

    // Reset state and open sheet
    setGenerating(true);
    setSpec(null);
    setGeneratedReport(null);
    setGenError(null);
    setStreamingText("");
    setReasoningText("");
    setGenSheetOpen(true);

    try {
      const date = formatCurrentDate();
      const logContent = await readLog(date);

      if (!logContent.trim()) {
        setGenerating(false);
        setGenError(t("today.noEntries"));
        return;
      }

      const dailyPrompt = `按以下格式生成日报：
1. 今日完成工作（列出具体事项和进度）
2. 遇到的问题及解决方案
3. 明日计划
4. 需要协调的事项（如没有则省略）

要求：简洁明了，每项工作一句话概括，重点突出成果和进度。`;

      await generateReport({
        aiConfig: config.ai,
        logs: logContent,
        dateRange: date,
        customInstruction: dailyPrompt,
        phase: "generation",
        onTextUpdate: (text) => setStreamingText(text),
        onReasoningUpdate: (text) => setReasoningText(text),
        onSpecUpdate: (s) => setSpec(s),
        onComplete: (s, text) => {
          setGenerating(false);
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

  async function handleSaveDailyReport() {
    if (!spec && !generatedReport) return;

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `report-${dateStr}`;

    let reportContent = generatedReport || "";
    if (spec?.elements) {
      for (const el of Object.values(spec.elements)) {
        const elem = el as { type?: string; props?: { content?: string; title?: string } };
        if (elem.type === "ReportPreview" && elem.props?.content) {
          reportContent = `# ${elem.props.title || "日报"}\n\n${elem.props.content}`;
          break;
        }
      }
    }

    try {
      await writeReport(filename, reportContent);
      setGenSheetOpen(false);
      // Reset state
      setSpec(null);
      setGeneratedReport(null);
      setStreamingText("");
      setReasoningText("");
      setGenError(null);
    } catch (e) {
      console.error("Failed to save report:", e);
    }
  }

  function resetGenState() {
    setSpec(null);
    setGeneratedReport(null);
    setStreamingText("");
    setReasoningText("");
    setGenError(null);
    setGenerating(false);
  }

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTime, setEditTime] = useState("");
  const [editContent, setEditContent] = useState("");
  const editContentRef = useRef<HTMLTextAreaElement>(null);
  const editTimeRef = useRef<HTMLInputElement>(null);
  // Track latest values via ref to avoid stale closure in blur handlers
  const latestEditTime = useRef("");
  const latestEditContent = useRef("");
  const isSaving = useRef(false);
  const pendingFocusIndex = useRef<number | null>(null);

  const syncEditTime = (v: string) => { setEditTime(v); latestEditTime.current = v; };
  const syncEditContent = (v: string) => { setEditContent(v); latestEditContent.current = v; };

  // After entries refresh, auto-focus the pending block (after deletion)
  useEffect(() => {
    if (pendingFocusIndex.current !== null) {
      const idx = pendingFocusIndex.current;
      pendingFocusIndex.current = null;
      if (idx >= 0 && idx < sortedEntries.length) {
        startEdit(idx, sortedEntries[idx], "content");
      }
    }
  }, [entries]);

  const startEdit = (index: number, entry: LogEntry, focusField?: "time" | "content") => {
    setEditingIndex(index);
    syncEditTime(entry.time);
    syncEditContent(entry.content);
    requestAnimationFrame(() => {
      const target = focusField === "time" ? editTimeRef.current : editContentRef.current;
      target?.focus();
      // Move cursor to end of textarea
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

    const originalEntry = sortedEntries[idx];
    // Prefer DOM values from blur; fall back to refs for keyboard shortcuts
    const newTime = (domTime ?? latestEditTime.current).trim();
    const newContent = (domContent ?? latestEditContent.current).trim();

    isSaving.current = true;
    cancelEdit();

    try {
      const date = formatCurrentDate();
      const currentLog = await readLog(date);
      const allEntries = parseLogEntries(currentLog);

      if (!newContent) {
        // Empty content = delete entry
        const filtered = allEntries.filter(
          (e) => !(e.time === originalEntry.time && e.content === originalEntry.content)
        );
        let newLog = `---\ndate: ${date}\n---`;
        for (const entry of filtered) {
          newLog += `\n\n## ${entry.time}\n\n${entry.content}`;
        }
        await writeLog(date, newLog);
        // Focus previous block after refresh (index i-1 in sorted order)
        pendingFocusIndex.current = idx - 1;
      } else if (newTime !== originalEntry.time || newContent !== originalEntry.content) {
        // Update entry
        const entryIdx = allEntries.findIndex(
          (e) => e.time === originalEntry.time && e.content === originalEntry.content
        );
        if (entryIdx >= 0) {
          allEntries[entryIdx] = { time: newTime, content: newContent };
          let newLog = `---\ndate: ${date}\n---`;
          for (const entry of allEntries) {
            newLog += `\n\n## ${entry.time}\n\n${entry.content}`;
          }
          await writeLog(date, newLog);
        }
      }
      loadEntries();
    } catch (e) {
      console.error("Failed to save edit:", e);
    } finally {
      isSaving.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">{t("today.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{dateDisplay}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleGenerateDailyReport}
          title={t("today.generateReport")}
          disabled={!aiConfigured}
        >
          <Sparkles className="w-4 h-4" />
        </Button>
      </div>

      {/* First-launch shortcut hint banner */}
      {showHint && (
        <div className="mb-4 flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-muted/50 text-sm">
          <span className="flex-1">
            {t("today.emptyHint", { shortcut: shortcutDisplay })}
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <HelpCircle className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <ShortcutsHelpDialog shortcut={shortcut} />
          </Dialog>
          <button
            onClick={dismissHint}
            className="text-muted-foreground hover:text-foreground transition-colors ml-1"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
      )}

      {sortedEntries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <FileText className="w-12 h-12 opacity-30" />
          <p>{t("today.empty")}</p>
          <p className="text-sm">{t("today.emptyHint", { shortcut: shortcutDisplay })}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-0 divide-y divide-border">
            {sortedEntries.map((entry, i) => (
              <div
                key={`${entry.time}-${i}`}
                className="group py-3 px-1"
              >
                {editingIndex === i ? (
                  /* --- Editing state --- */
                  <div>
                    <input
                      ref={editTimeRef}
                      value={editTime}
                      onChange={(e) => syncEditTime(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                        if (e.key === "Enter") { e.preventDefault(); editContentRef.current?.focus(); }
                        // Time empty + Backspace: if content also empty → delete entry; else do nothing
                        if (e.key === "Backspace" && !editTime) {
                          e.preventDefault();
                          if (!editContent) {
                            saveEdit("", "");
                          }
                        }
                      }}
                      onBlur={(e) => {
                        // Don't save if focus is moving to the content textarea in same entry
                        if (e.relatedTarget === editContentRef.current) return;
                        saveEdit(editTimeRef.current?.value, editContentRef.current?.value);
                      }}
                      className="w-full block bg-transparent text-xs font-mono text-muted-foreground outline-none border-0 caret-foreground p-0 h-auto"
                      placeholder="HH:mm"
                    />
                    <textarea
                      ref={editContentRef}
                      value={editContent}
                      onChange={(e) => syncEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(editTimeRef.current?.value, editContentRef.current?.value); }
                        // Content empty + Backspace: jump to time field
                        if (e.key === "Backspace" && !editContent) {
                          e.preventDefault();
                          editTimeRef.current?.focus();
                        }
                      }}
                      onBlur={(e) => {
                        // Don't save if focus is moving to the time input in same entry
                        if (e.relatedTarget === editTimeRef.current) return;
                        saveEdit(editTimeRef.current?.value, editContentRef.current?.value);
                      }}
                      className="w-full bg-transparent text-sm whitespace-pre-wrap leading-relaxed resize-none outline-none border-0 min-h-[1.5em] p-0 caret-foreground"
                      rows={editContent.split("\n").length}
                    />
                  </div>
                ) : (
                  /* --- Display state --- */
                  <div
                    className="cursor-text"
                    onClick={(e) => {
                      // If click is on the time area, focus time; otherwise content
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
        </ScrollArea>
      )}

      {/* Daily report generation Sheet */}
      <Sheet open={genSheetOpen} onOpenChange={(open) => { if (!open) resetGenState(); setGenSheetOpen(open); }}>
        <SheetContent side="right" className="flex flex-col overflow-hidden w-[480px] max-w-[90vw]">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("today.generateReport")}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-auto">
            {/* Error state */}
            {genError && (
              <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-md p-3">
                <p className="whitespace-pre-wrap break-words text-xs">{genError}</p>
              </div>
            )}

            {/* Generating state */}
            {generating && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {reasoningText ? t("reports.generate.buildingReport") : t("reports.generate.thinking")}
                </p>
                {reasoningText && (
                  <details className="w-full mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer">
                      {t("reports.generate.viewThinking")}
                    </summary>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words mt-2 max-h-40 overflow-auto">
                      {reasoningText}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {/* Spec result (json-render) */}
            {spec?.root && spec.elements?.[spec.root] && (
              <div className="py-2">
                <StateProvider initialState={{}}>
                  <VisibilityProvider>
                    <ActionProvider
                      handlers={{
                        save_report: async () => { await handleSaveDailyReport(); },
                      }}
                    >
                      <Renderer spec={spec} registry={registry} loading={generating} />
                    </ActionProvider>
                  </VisibilityProvider>
                </StateProvider>
              </div>
            )}

            {/* Streaming text (shown during generation before spec appears, or when AI returns plain text) */}
            {streamingText && !spec?.root && !generatedReport && (
              <div className="py-2">
                <pre className="text-sm whitespace-pre-wrap leading-relaxed">{streamingText}</pre>
              </div>
            )}

            {/* Plain text result */}
            {!spec?.root && generatedReport && (
              <div className="py-2">
                <pre className="text-sm whitespace-pre-wrap leading-relaxed">{generatedReport}</pre>
              </div>
            )}
          </div>

          {/* Bottom actions — only show for plain text reports (json-render specs have their own ActionButtons) */}
          {!spec?.root && generatedReport && !generating && !genError && (
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSaveDailyReport} className="flex-1">
                {t("reports.generate.saveReport")}
              </Button>
              <Button variant="outline" onClick={() => { resetGenState(); handleGenerateDailyReport(); }}>
                {t("reports.generate.regenerate")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SettingsView({
  config,
  onConfigChange,
}: {
  config: AppConfig;
  onConfigChange: (cfg: AppConfig) => void;
}) {
  const [storagePath, setStoragePath] = useState(config.storage_path);
  const [shortcut, setShortcut] = useState(config.shortcut || DEFAULT_SHORTCUT);
  const [screenshotShortcut, setScreenshotShortcut] = useState(config.screenshot_shortcut || DEFAULT_SCREENSHOT_SHORTCUT);
  const [theme, setTheme] = useState<Theme>(config.theme || "system");
  const [showHintBar, setShowHintBar] = useState(config.show_hint_bar ?? true);
  const [locale, setLocaleState] = useState(config.locale || "system");
  const savedProvider = config.ai?.provider;
  const validProvider: AiProviderKey =
    savedProvider && savedProvider in AI_PROVIDERS
      ? (savedProvider as AiProviderKey)
      : "opencode-go";
  const [aiProvider, setAiProvider] = useState<AiProviderKey>(validProvider);
  const [aiBaseUrl, setAiBaseUrl] = useState(
    config.ai?.api_base_url || AI_PROVIDERS[validProvider].baseUrl
  );
  const [aiApiKey, setAiApiKey] = useState(config.ai?.api_key || "");
  const [aiModel, setAiModel] = useState(
    config.ai?.model || "glm-5.1"
  );
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(false);

  const currentAiConfig: AiConfig = { provider: aiProvider, api_base_url: aiBaseUrl, api_key: aiApiKey, model: aiModel };

  // Auto-save whenever config changes
  function persistConfig(path: string, sc: string, th: Theme, screenshotSc?: string, shb?: boolean, lc?: string, aiCfg?: AiConfig) {
    const newConfig: AppConfig = {
      storage_path: path,
      shortcut: sc,
      screenshot_shortcut: screenshotSc,
      theme: th,
      show_hint_bar: shb,
      locale: lc,
      ai: aiCfg,
      report_presets: config.report_presets,
      selected_report_preset: config.selected_report_preset,
    };
    onConfigChange(newConfig);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
    savedTimeout.current = setTimeout(async () => {
      try {
        await saveConfig(newConfig);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        console.error("Failed to save config:", e);
      }
    }, 300);
  }

  async function handleChooseFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("settings.storage.title"),
      });
      if (selected) {
        const path = typeof selected === "string" ? selected : selected;
        setStoragePath(path as string);
        persistConfig(path as string, shortcut, theme, screenshotShortcut, showHintBar, locale, currentAiConfig);
      }
    } catch (e) {
      console.error("Failed to choose folder:", e);
    }
  }

  const themeOptions: { value: Theme; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            {t("settings.storage.title")}
            {saved && <span className="text-xs text-muted-foreground font-normal ml-auto">{t("settings.storage.saved")}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={storagePath}
              onChange={(e) => {
                setStoragePath(e.target.value);
                persistConfig(e.target.value, shortcut, theme, screenshotShortcut, showHintBar, locale, currentAiConfig);
              }}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleChooseFolder}>
              {t("settings.storage.browse")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.storage.description")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            {t("settings.shortcut.title")}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-auto h-7 w-7">
                  <HelpCircle className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <ShortcutsHelpDialog shortcut={formatShortcutForDisplay(shortcut)} />
            </Dialog>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.shortcut.quickRecord")}</label>
            <ShortcutRecorder
              value={shortcut}
              onChange={(s) => {
                setShortcut(s);
                persistConfig(storagePath, s, theme, screenshotShortcut, showHintBar, locale, currentAiConfig);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.shortcut.hint")}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.shortcut.screenshot")}</label>
            <ShortcutRecorder
              value={screenshotShortcut ?? DEFAULT_SCREENSHOT_SHORTCUT}
              onChange={(s) => {
                setScreenshotShortcut(s);
                persistConfig(storagePath, shortcut, theme, s, showHintBar, locale, currentAiConfig);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.shortcut.screenshotHint")}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">{t("settings.shortcut.showHintBar")}</span>
            <Button
              variant={showHintBar ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const newVal = !showHintBar;
                setShowHintBar(newVal);
                persistConfig(storagePath, shortcut, theme, screenshotShortcut, newVal, locale, currentAiConfig);
              }}
            >
              {showHintBar ? t("common.yes") : t("common.no")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="w-5 h-5" />
            {t("settings.appearance.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("settings.appearance.theme")}</span>
            <Select
              value={theme}
              onValueChange={(val) => {
                setTheme(val as Theme);
                persistConfig(storagePath, shortcut, val as Theme, screenshotShortcut, showHintBar, locale, currentAiConfig);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {themeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("settings.appearance.language")}</span>
            <Select
              value={locale}
              onValueChange={(val) => {
                setLocaleState(val);
                setLocale(val === "system" ? "system" : val);
                persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, val, currentAiConfig);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            {t("settings.ai.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.ai.provider")}</label>
            <Select
              value={aiProvider}
              onValueChange={(val) => {
                const key = val as AiProviderKey;
                const preset = AI_PROVIDERS[key];
                setAiProvider(key);
                if (preset.baseUrl) setAiBaseUrl(preset.baseUrl);
                const defaultModel = preset.models.length > 0 ? preset.models[0] : "";
                setAiModel(defaultModel);
                persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, locale, {
                  provider: key,
                  api_base_url: preset.baseUrl || aiBaseUrl,
                  api_key: aiApiKey,
                  model: defaultModel || aiModel,
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="opencode-go">OpenCode Go</SelectItem>
                <SelectItem value="zhipu-coding-plan">智谱 Coding Plan</SelectItem>
                <SelectItem value="custom">{t("settings.ai.customProvider")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {AI_PROVIDERS[aiProvider].showBaseUrl && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("settings.ai.baseUrl")}</label>
              <Input
                value={aiBaseUrl}
                onChange={(e) => {
                  setAiBaseUrl(e.target.value);
                  persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, locale, {
                    provider: aiProvider,
                    api_base_url: e.target.value,
                    api_key: aiApiKey,
                    model: aiModel,
                  });
                }}
                placeholder="https://api.example.com/v1"
              />
            </div>
          )}
          {AI_PROVIDERS[aiProvider].needsApiKey && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("settings.ai.apiKey")}</label>
              <Input
                type="password"
                value={aiApiKey}
                onChange={(e) => {
                  setAiApiKey(e.target.value);
                  persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, locale, {
                    provider: aiProvider,
                    api_base_url: aiBaseUrl,
                    api_key: e.target.value,
                    model: aiModel,
                  });
                }}
                placeholder={t("settings.ai.apiKeyPlaceholder")}
              />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.ai.model")}</label>
            {AI_PROVIDERS[aiProvider].models.length > 0 ? (
              <Select
                value={aiModel}
                onValueChange={(val) => {
                  setAiModel(val);
                  persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, locale, {
                    provider: aiProvider,
                    api_base_url: aiBaseUrl,
                    api_key: aiApiKey,
                    model: val,
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS[aiProvider].models.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={aiModel}
                onChange={(e) => {
                  setAiModel(e.target.value);
                  persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, locale, {
                    provider: aiProvider,
                    api_base_url: aiBaseUrl,
                    api_key: aiApiKey,
                    model: e.target.value,
                  });
                }}
                placeholder="model-name"
              />
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

export default App;