import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getConfig,
  saveConfig,
  readLog,
  writeLog,
  listLogs,
  DEFAULT_SHORTCUT,
  DEFAULT_SCREENSHOT_SHORTCUT,
  checkOpenCodeInstalled,
  startOpenCode,
  isOpencodeRunning,
  type AppConfig,
  type Theme,
} from "./lib/api";
import { formatCurrentDate } from "./lib/utils";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { t, initLocale, setLocale, SUPPORTED_LOCALES } from "./lib/i18n";

/** URL-safe base64 encoding matching OpenCode's encode.ts */
function base64EncodePath(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const OPENCODE_PORT = 4096;
const OPENCODE_BASE = `http://127.0.0.1:${OPENCODE_PORT}`;
import { LogViewer } from "./components/LogViewer";
import { SetupGuide } from "./components/SetupGuide";
import { ShortcutRecorder, formatShortcutForDisplay } from "./components/ShortcutRecorder";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Dialog, DialogTrigger } from "./components/ui/dialog";
import { FolderOpen, Settings, Sun, HelpCircle } from "lucide-react";
import { ShortcutsHelpDialog } from "./components/ShortcutsHelpDialog";
import { ReportsView } from "./components/ReportsView";
import { RichTextEditor } from "./components/RichTextEditor";

type View = "today" | "logs" | "reports" | "ai" | "settings";

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("today");
  const [logDates, setLogDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(formatCurrentDate());

  const [logContent, setLogContent] = useState("");
  const [theme, setTheme] = useState<Theme>("system");
  const [aiSessionUrl, setAiSessionUrl] = useState<string | undefined>(undefined);

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

  // NOTE: Global shortcut registration is handled entirely in Rust
  // (setup() registers on launch, save_config re-registers on change).
  // JS-side registration was removed because it conflicted with Rust:
  // unregister() wiped the Rust registration, and the empty JS callback
  // served no purpose.

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
                active={view === "ai"}
                onClick={() => setView("ai")}
              >
                AI
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
              onSwitchToAi={() => setView("ai")}
              onSessionCreated={(url: string | undefined) => setAiSessionUrl(url)}
            />
          </TabsContent>

          <TabsContent active={view === "logs"} className="flex-1 overflow-hidden">
            <LogViewer
              dates={logDates}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              logContent={logContent}
              onRefresh={handleRefreshLogs}
              storagePath={config.storage_path}
            />
          </TabsContent>

          <TabsContent active={view === "reports"} className="flex-1 overflow-hidden">
            <ReportsView config={config} onConfigChange={handleConfigChange} />
          </TabsContent>

          <TabsContent active={view === "ai"} className="flex-1 overflow-hidden">
            <OpenCodeView config={config} sessionUrl={aiSessionUrl} />
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
  onSwitchToAi,
  onSessionCreated,
}: {
  shortcutDisplay: string;
  shortcut: string;
  config: AppConfig;
  onSwitchToAi: () => void;
  onSessionCreated: (url: string | undefined) => void;
}) {
  const [logContent, setLogContent] = useState("");
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("hasSeenShortcutHint"));
  const [openCodeChecking, setOpenCodeChecking] = useState(false);
  const [showOpenCodeDialog, setShowOpenCodeDialog] = useState(false);
  const [openCodeError, setOpenCodeError] = useState<string | null>(null);

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

  const loadContent = useCallback(async () => {
    try {
      const date = formatCurrentDate();
      const content = await readLog(date);
      setLogContent(content);
    } catch (e) {
      console.error("Failed to load today's log:", e);
      setLogContent("");
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadContent();
  }, [loadContent]);

  // Reload when window gains focus (quick-input may have saved data)
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        loadContent();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadContent]);

  const handleGenerateWithOpenCode = useCallback(async () => {
    setOpenCodeChecking(true);
    setOpenCodeError(null);
    try {
      const installed = await checkOpenCodeInstalled();
      if (!installed) {
        setShowOpenCodeDialog(true);
        return;
      }
      await startOpenCode(config.storage_path);

      // Build prompt with today's log content
      const date = formatCurrentDate();
      const todayLog = await readLog(date);
      const promptText = todayLog
        ? `请根据以下今日工作日志内容，帮我生成一份日报：\n\n${todayLog}`
        : `今天是 ${date}，目前还没有记录任何工作日志。请帮我开始记录。`;

      try {
        // Create session via OpenCode API (tauriFetch bypasses CORS)
        console.log("[日报] Creating session...");
        const sessionRes = await tauriFetch(`${OPENCODE_BASE}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `日报 ${date}` }),
        });
        const session = await sessionRes.json();
        const sessionId = session.id;
        console.log("[日报] Session created:", sessionId);

        // Send the prompt and wait for the AI to finish responding.
        // The message API blocks until the full response is ready.
        // tauriFetch has no read timeout so it will wait indefinitely,
        // which is fine — opencode's AI typically responds in 5-30s.
        console.log("[日报] Sending message...");
        const msgRes = await tauriFetch(`${OPENCODE_BASE}/session/${sessionId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parts: [{ type: "text", text: promptText }],
          }),
        });
        console.log("[日报] Message response status:", msgRes.status);

        // Only navigate after the message & response are fully persisted,
        // so the session page always renders the complete conversation.
        const encodedDir = base64EncodePath(config.storage_path);
        const sessionUrl = `${OPENCODE_BASE}/${encodedDir}/session/${sessionId}`;
        console.log("[日报] Navigating to:", sessionUrl);
        onSessionCreated(sessionUrl);
      } catch (apiErr) {
        // API call failed — still switch to AI tab but show error
        console.error("[日报] OpenCode API error:", apiErr);
        setOpenCodeError(String(apiErr));
        // Fall back to project home (no specific session)
        onSessionCreated(undefined);
      }

      onSwitchToAi();
    } catch (e) {
      console.error("Failed to start OpenCode:", e);
      setOpenCodeError(String(e));
    } finally {
      setOpenCodeChecking(false);
    }
  }, [config.storage_path, onSwitchToAi, onSessionCreated]);

  const handleChange = useCallback(async (markdown: string) => {
    setLogContent(markdown);
    const date = formatCurrentDate();
    await writeLog(date, markdown);
  }, []);

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">{t("today.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{dateDisplay}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateWithOpenCode}
            disabled={openCodeChecking}
          >
            {openCodeChecking ? t("today.generating") : t("today.generateReport")}
          </Button>
          {openCodeError && (
            <p className="text-xs text-red-500 max-w-xs truncate" title={openCodeError}>
              {openCodeError}
            </p>
          )}
        </div>
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

      {showOpenCodeDialog && (
        <div className="mb-4 rounded-lg border border-border bg-muted/50 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-medium mb-1">{t("opencode.install.title")}</h3>
              <p className="text-sm text-muted-foreground mb-2">
                {t("opencode.install.description")}
              </p>
              <code className="text-xs bg-background px-2 py-1 rounded border border-border">
                npm i -g opencode
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                <a
                  href="https://opencode.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  opencode.ai →
                </a>
              </p>
            </div>
            <button
              onClick={() => setShowOpenCodeDialog(false)}
              className="text-muted-foreground hover:text-foreground transition-colors ml-3"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <RichTextEditor
        content={logContent}
        storagePath={config.storage_path}
        onChange={handleChange}
        className="flex-1 overflow-auto"
      />
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
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(false);

  // Auto-save whenever config changes
  function persistConfig(path: string, sc: string, th: Theme, screenshotSc?: string, shb?: boolean, lc?: string) {
    const newConfig: AppConfig = {
      storage_path: path,
      shortcut: sc,
      screenshot_shortcut: screenshotSc,
      theme: th,
      show_hint_bar: shb,
      locale: lc,
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
        persistConfig(path as string, shortcut, theme, screenshotShortcut, showHintBar, locale);
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
                persistConfig(e.target.value, shortcut, theme, screenshotShortcut, showHintBar, locale);
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
                persistConfig(storagePath, s, theme, screenshotShortcut, showHintBar, locale);
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
                persistConfig(storagePath, shortcut, theme, s, showHintBar, locale);
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
                persistConfig(storagePath, shortcut, theme, screenshotShortcut, newVal, locale);
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
                persistConfig(storagePath, shortcut, val as Theme, screenshotShortcut, showHintBar, locale);
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
                persistConfig(storagePath, shortcut, theme, screenshotShortcut, showHintBar, val);
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

    </div>
  );
}

function OpenCodeView({ config, sessionUrl }: { config: AppConfig; sessionUrl?: string }) {
  const [serverReady, setServerReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showInstallDialog, setShowInstallDialog] = useState(false);

  // Build the base project URL with base64-encoded directory path
  const projectUrl = useMemo(() => {
    const encoded = base64EncodePath(config.storage_path);
    return `${OPENCODE_BASE}/${encoded}`;
  }, [config.storage_path]);

  // Use session URL if provided (from "生成日报"), otherwise project home
  const iframeSrc = sessionUrl || projectUrl;

  useEffect(() => {
    isOpencodeRunning().then((running) => {
      if (running) setServerReady(true);
    });
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      const installed = await checkOpenCodeInstalled();
      if (!installed) {
        setShowInstallDialog(true);
        return;
      }
      await startOpenCode(config.storage_path);
      // Brief delay to ensure server is fully ready
      await new Promise((r) => setTimeout(r, 500));
      setServerReady(true);
    } catch (e) {
      console.error("Failed to start OpenCode:", e);
    } finally {
      setStarting(false);
    }
  }, [config.storage_path]);

  return (
    <div className="flex flex-col h-full">
      {!serverReady && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            {showInstallDialog ? (
              <div className="rounded-lg border border-border bg-muted/50 p-6 max-w-md">
                <h3 className="font-medium mb-2">{t("opencode.install.title")}</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {t("opencode.install.description")}
                </p>
                <code className="text-xs bg-background px-2 py-1 rounded border border-border">
                  npm i -g opencode
                </code>
                <p className="text-xs text-muted-foreground mt-3">
                  <a
                    href="https://opencode.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    opencode.ai →
                  </a>
                </p>
                <div className="mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowInstallDialog(false)}>
                    {t("common.close")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground">{t("opencode.start.hint")}</p>
                <Button onClick={handleStart} disabled={starting}>
                  {starting ? "..." : t("opencode.start.button")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {serverReady && (
        <iframe
          src={iframeSrc}
          className="flex-1 w-full border-0"
          title="OpenCode"
          style={{
            colorScheme: config.theme === "dark" ? "dark" : config.theme === "light" ? "light" : undefined,
          }}
        />
      )}
    </div>
  );
}

export default App;