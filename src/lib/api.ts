import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_SCREENSHOT_SHORTCUT = "CommandOrControl+Shift+S";
export const DEFAULT_AI_BASE_URL = "https://opencode.ai/zen/go/v1";
export const DEFAULT_AI_MODEL = "glm-5.1";

export type Theme = "light" | "dark" | "system";

export interface AiConfig {
  provider: string;
  api_base_url: string;
  api_key: string;
  model: string;
}

export const AI_PROVIDERS = {
  "opencode-go": {
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    models: ["glm-5.1", "glm-5", "kimi-k2.5", "mimo-v2-pro", "mimo-v2-omni", "qwen3.6-plus", "qwen3.5-plus"],
    needsApiKey: true,
    showBaseUrl: false,
  },
  "zhipu-coding-plan": {
    name: "智谱 Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    models: ["glm-5.1", "glm-5-turbo", "glm-4.7", "glm-4.5-air"],
    needsApiKey: true,
    showBaseUrl: false,
  },
  custom: {
    name: "自定义 API",
    baseUrl: "",
    models: [] as string[],
    needsApiKey: true,
    showBaseUrl: true,
  },
} as const;

export type AiProviderKey = keyof typeof AI_PROVIDERS;

export interface ReportPreset {
  id: string;
  name: string;
  prompt: string;
  dateRange?: "today" | "week" | "month";
}

export const DEFAULT_REPORT_PRESETS: ReportPreset[] = [
  {
    id: "daily",
    name: "日报",
    dateRange: "today",
    prompt: `按以下格式生成日报：
1. 今日完成工作（列出具体事项和进度）
2. 遇到的问题及解决方案
3. 明日计划
4. 需要协调的事项（如没有则省略）

要求：简洁明了，每项工作一句话概括，重点突出成果和进度。`,
  },
  {
    id: "weekly",
    name: "周报",
    dateRange: "week",
    prompt: `按以下格式生成周报：
1. 本周工作总结（按项目或任务分类，列出关键成果和进度百分比）
2. 遇到的问题及解决方案
3. 下周工作计划
4. 风险与需协调事项（如没有则省略）

要求：突出重点成果，量化进度，问题部分写明解决方案或所需支持。`,
  },
  {
    id: "monthly",
    name: "月报",
    dateRange: "month",
    prompt: `按以下格式生成月报：
1. 本月工作概述（总体进展和关键里程碑）
2. 各项目/任务详细进展（按项目分组，含完成情况、数据指标）
3. 问题与挑战
4. 下月工作计划与目标
5. 需要的支持与资源

要求：注重数据支撑和目标达成情况，体现工作价值。`,
  },
  {
    id: "quarterly",
    name: "季报",
    dateRange: "month",
    prompt: `按以下格式生成季度报告：
1. 季度工作概述（总体目标与实际达成对比）
2. 重点项目进展（含关键指标、里程碑完成情况）
3. 团队协作与个人成长
4. 存在的问题与改进措施
5. 下季度工作规划与目标

要求：战略视角，突出目标完成度和业务价值，有数据支撑。`,
  },
  {
    id: "annual",
    name: "年报",
    dateRange: "month",
    prompt: `按以下格式生成年报：
1. 年度工作总结（年度目标回顾与整体表现）
2. 核心成果与亮点（按项目/领域分类）
3. 能力成长与经验总结
4. 不足与反思
5. 新年度工作规划

要求：全面总结，体现年度贡献和成长轨迹，为绩效评估提供依据。`,
  },
];

export interface AppConfig {
  storage_path: string;
  shortcut: string;
  screenshot_shortcut?: string;
  theme?: Theme;
  show_hint_bar?: boolean;
  locale?: string;
  ai?: AiConfig;
  report_presets?: ReportPreset[];
  selected_report_preset?: string;
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
