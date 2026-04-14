import { useState, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { X, Keyboard } from "lucide-react";
import { t } from "../lib/i18n";

/**
 * Convert a browser KeyboardEvent to a Tauri shortcut string.
 * E.g. CommandOrControl+Shift+Space, Alt+K
 */
function keyboardEventToShortcut(e: KeyboardEvent): string | null {
  const modifiers: string[] = [];
  if (e.ctrlKey || e.metaKey) modifiers.push("CommandOrControl");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.altKey) modifiers.push("Alt");

  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  if (modifiers.length === 0) return null;

  let keyName: string;
  if (key === " ") keyName = "Space";
  else if (key.length === 1) keyName = key.toUpperCase();
  else if (key === "Escape") keyName = "Escape";
  else if (key === "Enter") keyName = "Return";
  else if (key === "Backspace") keyName = "Backspace";
  else if (key === "Tab") keyName = "Tab";
  else if (key === "Delete") keyName = "Delete";
  else if (key.startsWith("Arrow")) keyName = key.replace("Arrow", "");
  else if (key.startsWith("F") && /^F\d{1,2}$/.test(key)) keyName = key;
  else if (key === "Insert") keyName = "Insert";
  else if (key === "Home") keyName = "Home";
  else if (key === "End") keyName = "End";
  else if (key === "PageUp") keyName = "PageUp";
  else if (key === "PageDown") keyName = "PageDown";
  else return null;

  return [...modifiers, keyName].sort((a, b) => {
    const order: Record<string, number> = { CommandOrControl: 0, Alt: 1, Shift: 2 };
    if (order[a] !== undefined && order[b] !== undefined) return order[a] - order[b];
    if (order[a] !== undefined) return -1;
    if (order[b] !== undefined) return 1;
    return 0;
  }).join("+");
}

/**
 * Build a display string from currently-held modifiers + optional key.
 * e.g. { ctrl: true, shift: true, alt: false } + "Space" → "Ctrl + Shift + Space"
 */
function buildDisplayCombo(
  modifiers: { ctrl: boolean; shift: boolean; alt: boolean },
  key: string | null,
): string {
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push("Ctrl");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.shift) parts.push("Shift");
  if (key) parts.push(key);
  return parts.join(" + ");
}

/** Format a Tauri shortcut string for display. */
export function formatShortcutForDisplay(shortcut: string): string {
  return shortcut.replace(/CommandOrControl/g, "Ctrl").replace(/\+/g, " + ");
}

interface ShortcutRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  // Live key state during recording
  const [liveModifiers, setLiveModifiers] = useState({ ctrl: false, shift: false, alt: false });
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const [confirmedShortcut, setConfirmedShortcut] = useState<string | null>(null);

  const startRecording = useCallback(() => {
    setRecording(true);
    setLiveModifiers({ ctrl: false, shift: false, alt: false });
    setLiveKey(null);
    setConfirmedShortcut(null);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setLiveModifiers({ ctrl: false, shift: false, alt: false });
    setLiveKey(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();

      // Update modifier state live
      setLiveModifiers({
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
      });

      // ESC cancels recording
      if (e.key === "Escape") {
        stopRecording();
        return;
      }

      const shortcut = keyboardEventToShortcut(e);
      if (shortcut) {
        // Extract display-friendly key name for live preview
        const parts = shortcut.split("+");
        const mainKey = parts[parts.length - 1] || null;
        setLiveKey(mainKey);
        setConfirmedShortcut(shortcut);
        onChange(shortcut);
        // Brief delay so user sees the confirmed combo before closing
        setTimeout(() => {
          stopRecording();
        }, 400);
      } else {
        // Modifier-only press
        setLiveKey(null);
      }
    },
    [recording, onChange, stopRecording],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      // Update modifier state on keyup for accurate live display
      setLiveModifiers({
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
      });
    },
    [recording],
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [recording, handleKeyDown, handleKeyUp]);

  // Determine what to display
  let displayText: string;
  if (confirmedShortcut) {
    displayText = formatShortcutForDisplay(confirmedShortcut);
  } else if (recording) {
    const combo = buildDisplayCombo(liveModifiers, liveKey);
    displayText = combo || t("shortcutRecorder.pressing");
  } else {
    displayText = formatShortcutForDisplay(value);
  }

  const showCursorBlink =
    recording &&
    !confirmedShortcut &&
    !liveKey &&
    !liveModifiers.ctrl &&
    !liveModifiers.shift &&
    !liveModifiers.alt;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className={`flex-1 px-3 py-2 rounded-md border text-sm font-mono min-h-[36px] flex items-center transition-colors cursor-pointer select-none ${
            recording
              ? "border-primary ring-2 ring-primary/30 bg-primary/5"
              : "border-input bg-background hover:border-primary/50"
          }`}
          onClick={() => {
            if (!recording) startRecording();
          }}
        >
          {recording && !confirmedShortcut ? (
            <span className="text-primary">
              {displayText}
              {showCursorBlink && <span className="animate-pulse">_</span>}
            </span>
          ) : confirmedShortcut ? (
            <span className="text-primary font-medium">{displayText}</span>
          ) : (
            <span>{displayText}</span>
          )}
        </div>
        {!recording ? (
          <Button variant="outline" size="sm" onClick={startRecording}>
            <Keyboard className="w-4 h-4 mr-1" />
            {t("shortcutRecorder.modify")}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={stopRecording}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      {recording && (
        <p className="text-xs text-muted-foreground">
          {t("shortcutRecorder.recordingHint")}
        </p>
      )}
    </div>
  );
}