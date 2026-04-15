#!/usr/bin/env node

import { Command } from "commander";
import { handleInspect } from "./inspect.js";
import { handleAdd } from "./add.js";
import { WorkerBeeError, ExitCode } from "./lib/errors.js";

const program = new Command();

program
  .name("workerbee")
  .version("0.1.0")
  .description(
    `WorkerBee CLI - AI Agent 工具链

本工具为 AI Agent 提供操作 WorkerBee 工作日志数据的能力。

报告生成流程：日志片段 → 日报 → 周报 → 月报 → 季报 → 年报

Agent 通过 inspect 获取数据目录结构与路径，
读取 logs/ 下的日志片段，结合 templates/ 中的模板，
逐级汇总生成各级报告，并将结果写入 reports/ 目录。
使用 add 可随时追加新的日志片段。`
  );

program
  .command("inspect")
  .description("返回数据目录路径及各子目录用途，Agent 据此定位和操作文件")
  .action(handleInspect);

program
  .command("add <content>")
  .description("追加一条日志片段到今日日志文件（logs/YYYY-MM-DD.md）")
  .action((content) => handleAdd(content));

program.parse();