import os from "os";
import path from "path";
import fs from "fs";

export function getDataDir(): string {
  // 1. 环境变量
  if (process.env.WORKERBEE_DATA_DIR) {
    return process.env.WORKERBEE_DATA_DIR;
  }

  // 2. 配置文件中读取
  const configPath = path.join(os.homedir(), ".workerbee", ".workerbee.config.json");
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as { storage_path?: string };
    if (config.storage_path) {
      return config.storage_path;
    }
  } catch {
    // 忽略，继续使用默认值
  }

  // 3. 默认值
  return path.join(os.homedir(), ".workerbee");
}