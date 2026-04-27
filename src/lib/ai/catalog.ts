import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const catalog = defineCatalog(schema, {
  components: {
    ClarifyCard: {
      props: z.object({
        message: z.string(),
        options: z.array(
          z.object({
            label: z.string(),
            value: z.string(),
          })
        ),
      }),
      description:
        "当你需要向用户提问以明确报告需求时使用。显示一条消息和多个选项按钮。",
    },
    ReportPreview: {
      props: z.object({
        title: z.string(),
        dateRange: z.string(),
        content: z.string(),
      }),
      slots: ["default"],
      description:
        "展示生成的报告预览。content 是 markdown 格式的报告正文。",
    },
    ReportMeta: {
      props: z.object({
        type: z.string(),
        generatedAt: z.string(),
        logCount: z.number(),
      }),
      description: "报告元信息（类型、生成时间、日志条目数）",
    },
    ActionButton: {
      props: z.object({
        label: z.string(),
        variant: z.enum(["primary", "secondary"]),
        action: z.string(),
      }),
      description:
        "操作按钮。action 指定要触发的动作名称（save_report / regenerate）。",
    },
    LogSelector: {
      props: z.object({
        message: z.string(),
        entries: z.array(
          z.object({
            id: z.string(),
            date: z.string(),
            summary: z.string(),
            selected: z.boolean(),
          })
        ),
      }),
      description:
        "显示日志文件列表供用户选择。每个条目代表一天的日志，有日期和概要信息。AI根据内容相关性预选文件，用户可以勾选/取消勾选，然后确认。id 就是日期字符串如 2026-04-20。",
    },
  },
  actions: {
    save_report: {
      description: "保存生成的报告到文件",
    },
    regenerate: {
      params: z.object({
        instruction: z.string().optional(),
      }),
      description: "根据反馈重新生成报告",
    },
    answer_clarify: {
      params: z.object({
        answer: z.string(),
      }),
      description: "回答追问",
    },
    confirm_logs: {
      params: z.object({
        selected_ids: z.array(z.string()),
      }),
      description: "用户确认选择要包含在报告中的日志条目ID列表",
    },
  },
});
