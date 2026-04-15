/**
 * Lightweight i18n module — reads locale JSON files and provides a `t()` translation function.
 *
 * Supported locales: en, zh-CN, ja, ko
 * Language detection order:
 *   1. Manual override via `setLocale(lang)`
 *   2. navigator.language match
 *   3. fallback to "en"
 */

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";

type LocaleMessages = typeof en;

const locales: Record<string, LocaleMessages> = {
  en,
  "zh-CN": zhCN,
  ja,
  ko,
};

// Detect browser language
function detectLocale(): string {
  const lang = navigator.language;
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

// Current locale (can be overridden)
let currentLocale: string = detectLocale();

// Manual override
export function setLocale(lang: string): void {
  if (locales[lang]) {
    currentLocale = lang;
  } else {
    console.warn(`[i18n] Unknown locale "${lang}", falling back to "en"`);
    currentLocale = "en";
  }
}

export function getLocale(): string {
  return currentLocale;
}

// Initialize locale from app config (call once when config loads)
export function initLocale(locale: string | undefined): void {
  if (locale && locale !== "system" && locales[locale]) {
    currentLocale = locale;
  }
  // "system" → keep current (browser detection)
}

export function isValidLocale(lang: string): boolean {
  return !!locales[lang];
}

export const SUPPORTED_LOCALES = [
  { value: "system", label: "System" },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

/**
 * Translate a key like "nav.today" or "settings.storage.title".
 * Supports interpolation: t("key", { name: "John" }) → "Hello John"
 * Falls back to "en" for missing keys.
 */
export function t(key: string, params?: Record<string, string>): string {
  const keys = key.split(".");
  let value: unknown = locales[currentLocale];

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // Fallback to English
      value = locales["en"];
      for (const fk of keys) {
        if (value && typeof value === "object" && fk in value) {
          value = (value as Record<string, unknown>)[fk];
        } else {
          return key; // Key not found in fallback either
        }
      }
      break;
    }
  }

  if (typeof value !== "string") return key;

  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  }

  return value;
}
