import fs from "fs";
import path from "path";
import { getDataDir } from "./data-dir.js";

export interface AddResult {
  success: boolean;
  file: string;
  time: string;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function addLogEntry(content: string): AddResult {
  const now = new Date();
  const dateStr = formatDate(now);
  const timeStr = formatTime(now);

  const dataDir = getDataDir();
  const logsDir = path.join(dataDir, "logs");
  const filePath = path.join(logsDir, `${dateStr}.md`);

  fs.mkdirSync(logsDir, { recursive: true });

  let fileContent = "";
  if (fs.existsSync(filePath)) {
    fileContent = fs.readFileSync(filePath, "utf-8");
  } else {
    fileContent = `---\ndate: ${dateStr}\n---\n`;
  }

  const entry = `\n## ${timeStr}\n\n${content}\n`;
  const newContent = fileContent.trimEnd() + entry;

  fs.writeFileSync(filePath, newContent, "utf-8");

  return { success: true, file: filePath, time: timeStr };
}