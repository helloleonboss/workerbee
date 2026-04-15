import { getDataDir } from "./lib/data-dir.js";

export function handleInspect(): void {
  const dataDir = getDataDir();

  const result = {
    data_dir: dataDir,
    structure: {
      "templates/": "报告模板目录，存放提示词文件，AI 读后生成对应格式报告",
      "logs/": "日志片段目录，每文件一天，命名 YYYY-MM-DD.md",
      "reports/": "生成的报告目录，AI 生成报告后写入此处",
    },
  };

  console.log(JSON.stringify(result, null, 2));
}