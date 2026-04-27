import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_SCREENSHOT_SHORTCUT = "CommandOrControl+Shift+S";

export type Theme = "light" | "dark" | "system";

export interface AppConfig {
  storage_path: string;
  shortcut: string;
  screenshot_shortcut?: string;
  theme?: Theme;
  show_hint_bar?: boolean;
  locale?: string;
}

export async function getConfig(): Promise<AppConfig | null> {
  return invoke<AppConfig | null>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export async function getDefaultStoragePath(): Promise<string> {
  return invoke<string>("get_default_storage_path");
}

export async function saveLog(date: string, time: string, content: string): Promise<void> {
  return invoke("save_log", { date, time, content });
}

export async function readLog(date: string): Promise<string> {
  return invoke<string>("read_log", { date });
}

export async function writeLog(date: string, content: string): Promise<void> {
  return invoke("write_log", { date, content });
}

export async function listLogs(): Promise<string[]> {
  return invoke<string[]>("list_logs");
}

export async function listReports(): Promise<string[]> {
  return invoke<string[]>("list_reports");
}

export async function readReport(filename: string): Promise<string> {
  return invoke<string>("read_report", { filename });
}

export async function writeReport(filename: string, content: string): Promise<void> {
  return invoke("write_report", { filename, content });
}

export async function chooseFolder(): Promise<string | null> {
  return invoke<string | null>("choose_folder");
}

// ─── Template API (file-based) ───

export interface TemplateInfo {
  filename: string;
  name: string;
  date_range: string | null;
  prompt: string;
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  return invoke<TemplateInfo[]>("list_templates");
}

export async function readTemplate(filename: string): Promise<TemplateInfo> {
  return invoke<TemplateInfo>("read_template", { filename });
}

export async function writeTemplate(
  filename: string,
  name: string,
  dateRange: string | null,
  prompt: string,
): Promise<void> {
  return invoke("write_template", { filename, name, dateRange, prompt });
}

export async function deleteTemplate(filename: string): Promise<void> {
  return invoke("delete_template", { filename });
}

// ─── Screenshot API ───

export type ScreenshotFormat = "webp" | "png" | "jpeg";

export async function cropAndSaveScreenshot(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  return invoke("crop_and_save_screenshot", { x, y, width, height });
}

export async function saveScreenshotLogEntry(imagePath: string, description?: string): Promise<void> {
  return invoke("save_screenshot_log_entry", { imagePath, description });
}

export async function closeScreenshotOverlay(): Promise<void> {
  return invoke("close_screenshot_overlay");
}

export async function cancelScreenshot(): Promise<void> {
  return invoke("cancel_screenshot");
}

export async function readScreenshotAsBase64(relativePath: string): Promise<string> {
  return invoke("read_screenshot_as_base64", { relativePath });
}

export interface ScreenshotInfo {
  filename: string;
  size_bytes: number;
  created_at: string;
  relative_path: string;
}

export async function listScreenshots(): Promise<ScreenshotInfo[]> {
  return invoke("list_screenshots");
}

export async function deleteScreenshot(filename: string): Promise<void> {
  return invoke("delete_screenshot", { filename });
}

export async function savePastedImage(base64Data: string, format: string): Promise<string> {
  return invoke("save_pasted_image", { base64Data, format });
}

// ─── OpenCode API ───

export async function checkOpenCodeInstalled(): Promise<boolean> {
  return invoke<boolean>("check_opencode_installed");
}

export async function startOpenCode(storagePath: string): Promise<void> {
  return invoke("start_opencode", { storagePath });
}

export async function isOpencodeRunning(): Promise<boolean> {
  return invoke<boolean>("is_opencode_running");
}
