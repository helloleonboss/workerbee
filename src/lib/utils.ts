import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrentTime(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLogEntries(content: string): LogEntry[] {
  if (!content) return [];

  const lines = content.split("\n");
  const entries: LogEntry[] = [];
  let currentTime = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const timeMatch = line.match(/^## (\d{2}:\d{2})$/);
    if (timeMatch) {
      if (currentTime) {
        entries.push({ time: currentTime, content: currentContent.join("\n").trim() });
      }
      currentTime = timeMatch[1];
      currentContent = [];
    } else if (currentTime && line.trim() && !line.startsWith("---") && !line.startsWith("date:")) {
      currentContent.push(line);
    }
  }

  if (currentTime) {
    entries.push({ time: currentTime, content: currentContent.join("\n").trim() });
  }

  return entries;
}

export interface LogEntry {
  time: string;
  content: string;
}