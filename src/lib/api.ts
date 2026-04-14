import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";

export type Theme = "light" | "dark" | "system";

export interface AppConfig {
  storage_path: string;
  shortcut: string;
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

export async function chooseFolder(): Promise<string | null> {
  return invoke<string | null>("choose_folder");
}