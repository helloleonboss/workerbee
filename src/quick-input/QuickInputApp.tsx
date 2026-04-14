import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, initLocale } from "../lib/i18n";

interface Config {
  storage_path: string;
  shortcut: string;
  theme?: "light" | "dark" | "system";
  show_hint_bar?: boolean;
  locale?: string;
}

function formatCurrentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function formatCurrentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function applyTheme(theme: "light" | "dark" | "system" | undefined) {
  const root = document.documentElement;

  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    // system or undefined - use prefers-color-scheme
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    if (prefersDark.matches) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
}

export default function QuickInputApp() {
  const [content, setContent] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system" | undefined>(undefined);
  const [showHintBar, setShowHintBar] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load theme config on mount
  useEffect(() => {
    invoke<Config>("get_config")
      .then((config) => {
        setTheme(config.theme);
        applyTheme(config.theme);
        setShowHintBar(config.show_hint_bar ?? true);
        initLocale(config.locale);
      })
      .catch((err) => {
        console.error("Failed to load config:", err);
      });
  }, []);

  // Listen for system theme changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyTheme("system");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    const unlisten = listen<Config>("quick-input-shown", (event) => {
      // Full config is sent from Rust — always fresh
      const config = event.payload;
      setTheme(config.theme);
      applyTheme(config.theme);
      setShowHintBar(config.show_hint_bar ?? true);
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleClose = useCallback(() => {
    invoke("hide_quick_input");
    setContent("");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) {
      handleClose();
      return;
    }
    try {
      await invoke("save_log", {
        date: formatCurrentDate(),
        time: formatCurrentTime(),
        content: content.trim(),
      });
    } catch (e) {
      console.error("save_log failed:", e);
    }
    setContent("");
    invoke("hide_quick_input");
  }, [content, handleClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === "Enter") {
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleClose, handleSubmit]
  );

  return (
    <div className="h-screen w-screen bg-background/95 backdrop-blur-xl rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden font-sans">
      {/* Main textarea */}
      <div className="flex-1 p-3 min-h-0">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("quickInput.placeholder")}
          className="w-full h-full resize-none border-none outline-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground font-inherit"
        />
      </div>

      {/* Bottom hint bar — toggleable via show_hint_bar config */}
      {showHintBar && (
        <div className="px-3 pb-2 pt-1 flex gap-3 items-center text-[11px] text-muted-foreground border-t border-border flex-shrink-0">
          <span>
            <kbd className="inline-block px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono leading-normal">
              Enter
            </kbd>{" "}
            {t("quickInput.hintSubmit")}
          </span>
          <span>
            <kbd className="inline-block px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono leading-normal">
              Shift+Enter
            </kbd>{" "}
            {t("quickInput.hintNewline")}
          </span>
          <span>
            <kbd className="inline-block px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono leading-normal">
              ESC
            </kbd>{" "}
            {t("quickInput.hintClose")}
          </span>
        </div>
      )}
    </div>
  );
}
