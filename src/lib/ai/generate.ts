import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  createSpecStreamCompiler,
  createMixedStreamParser,
  applySpecStreamPatch,
  type Spec,
  type SpecStreamLine,
} from "@json-render/core";
import { catalog } from "./catalog";
import type { AiConfig } from "../api";
import { readScreenshotAsBase64 } from "../api";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
}

export interface GenerateOptions {
  aiConfig: AiConfig;
  logs: string;
  dateRange: string;
  customInstruction?: string;
  /** Prior conversation turns to carry context across multi-round interactions */
  conversationHistory?: ChatMessage[];
  /** If "selection", instructs AI to show LogSelector instead of generating report directly */
  phase?: "selection" | "generation";
  /** Called with accumulated conversational text (non-JSONL) for display */
  onTextUpdate: (text: string) => void;
  onReasoningUpdate?: (text: string) => void;
  onSpecUpdate: (spec: Spec) => void;
  onComplete: (spec: Spec | null, text: string, history: ChatMessage[]) => void;
  onError: (error: Error) => void;
}

function parseSseDelta(text: string): { content: string; reasoning: string } {
  let content = "";
  let reasoning = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
    } catch {
      /* skip malformed */
    }
  }
  return { content, reasoning };
}

/**
 * Extract image references from markdown content
 * Returns array of relative paths like ["../screenshots/xxx.webp"]
 */
function extractImageReferences(content: string): string[] {
  const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
  const matches: string[] = [];
  let match;
  
  while ((match = imageRegex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  
  return matches;
}

/**
 * Build user message with images in OpenAI vision format
 * If no images, returns string content. Otherwise returns array with text and image_url entries.
 */
async function buildUserMessageWithImages(
  content: string,
  dateRange: string
): Promise<string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>> {
  const imagePaths = extractImageReferences(content);
  
  if (imagePaths.length === 0) {
    return content;
  }
  
  // Build vision format message
  const messageContent: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: `请根据以下日志内容生成报告。\n\n日期范围：${dateRange}\n\n日志内容：\n${content}` }
  ];
  
  // Add images (limit to 10 to avoid API limits)
  for (const imagePath of imagePaths.slice(0, 10)) {
    try {
      const base64Image = await readScreenshotAsBase64(imagePath);
      messageContent.push({
        type: "image_url",
        image_url: { url: base64Image }
      });
    } catch (error) {
      console.error(`Failed to read screenshot ${imagePath}:`, error);
      // Continue with other images even if one fails
    }
  }
  
  return messageContent;
}

/**
 * Replay collected JSONL patch lines through a fresh compiler with
 * requestAnimationFrame pacing. Each frame processes a few patches,
 * giving React time to render between frames — creating the visual
 * "building up" effect that json-render is known for.
 */
function replayPatchesIncremental(
  patches: SpecStreamLine[],
  initialSpec: Spec,
  onSpecUpdate: (spec: Spec) => void,
): Promise<Spec> {
  if (patches.length === 0) return Promise.resolve(initialSpec);

  return new Promise<Spec>((resolve) => {
    let spec = { ...initialSpec };
    let index = 0;

    function step() {
      // Process up to 3 patches per frame — fast enough to feel responsive,
      // slow enough for the user to see each element appear
      const batchEnd = Math.min(index + 3, patches.length);
      for (; index < batchEnd; index++) {
        applySpecStreamPatch(spec, patches[index]);
        spec = { ...spec };
        const valid = spec.root && spec.elements && spec.elements[spec.root];
        if (valid) {
          onSpecUpdate(spec);
        }
      }

      if (index < patches.length) {
        requestAnimationFrame(step);
      } else {
        resolve(spec);
      }
    }

    requestAnimationFrame(step);
  });
}

export async function generateReport(options: GenerateOptions) {
  const {
    aiConfig,
    logs,
    dateRange,
    customInstruction,
    conversationHistory,
    phase = "generation",
    onSpecUpdate,
    onTextUpdate,
    onReasoningUpdate,
    onComplete,
    onError,
  } = options;

  const systemPrompt = catalog.prompt({
    customRules: [
      "你是一个工作日志报告生成助手。",
      phase === "selection"
        ? `用户提供日志条目的概要信息。请使用 LogSelector 组件让用户确认要包含在报告中的日志条目。
根据条目内容智能预选最相关的条目。如果所有条目都相关，全部预选（selected: true）。
你必须将每条日志作为 entries 数组中的一个对象，包含 id（日期字符串）、date（日期）、summary（概要）、selected（是否预选）四个字段。
不要生成报告内容，只使用 LogSelector。等待用户确认选择后再生成报告。`
        : "分析用户提供的日志内容，自动判断应该生成什么类型的报告（日报、周报、月报等）。",
      phase === "selection"
        ? "只使用 LogSelector 组件，不要生成报告内容。等待用户确认选择后再生成报告。"
        : "如果日志内容明确，直接生成报告。",
      "报告使用中文。",
      customInstruction || "",
    ],
  });

  try {
    const url = `${aiConfig.api_base_url}/chat/completions`;

    // Build messages: system prompt + prior history (if multi-turn) or fresh user message
    const initialUserMessage = await buildUserMessageWithImages(logs, dateRange);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(conversationHistory?.length
        ? conversationHistory
        : [{ role: "user" as const, content: initialUserMessage }]),
    ];

    const response = await tauriFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(aiConfig.api_key ? { Authorization: `Bearer ${aiConfig.api_key}` } : {}),
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not streamable");

    const decoder = new TextDecoder();
    let fullContent = "";   // Full raw content from AI (for history)
    let reasoningText = "";
    let sseBuffer = "";

    // Separate conversational text from spec patches
    let conversationalText = "";
    const allPatches: SpecStreamLine[] = [];
    let streamPatchCount = 0; // How many patches arrived during streaming

    // Use the compiler to build spec in real-time during streaming
    const compiler = createSpecStreamCompiler<Spec>();

    // Use MixedStreamParser to separate text lines from JSONL patch lines
    const mixedParser = createMixedStreamParser({
      onText: (text) => {
        conversationalText += (conversationalText ? "\n" : "") + text;
        onTextUpdate(conversationalText);
      },
      onPatch: (patch) => {
        // Apply patch to the streaming compiler
        const { result, newPatches } = compiler.push(
          JSON.stringify(patch) + "\n"
        );
        if (newPatches.length > 0) {
          allPatches.push(patch);
          streamPatchCount++;
          const valid = result.root && result.elements && result.elements[result.root];
          if (valid) {
            onSpecUpdate(result);
          }
        }
      },
    });

    // Phase 1: Stream SSE data, separate text from patches, compile in real-time
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const rawChunk = decoder.decode(value, { stream: true });
      sseBuffer += rawChunk;

      const events = sseBuffer.split("\n\n");
      sseBuffer = events.pop() || "";

      for (const event of events) {
        const { content, reasoning } = parseSseDelta(event);

        if (reasoning) {
          reasoningText += reasoning;
          onReasoningUpdate?.(reasoningText);
        }

        if (content) {
          fullContent += content;
          // Feed content through mixed parser to separate text from JSONL
          mixedParser.push(content);
        }
      }
    }

    // Flush remaining SSE buffer
    if (sseBuffer.trim()) {
      const { content, reasoning } = parseSseDelta(sseBuffer);
      if (reasoning) {
        reasoningText += reasoning;
        onReasoningUpdate?.(reasoningText);
      }
      if (content) {
        fullContent += content;
        mixedParser.push(content);
      }
    }

    // Flush the mixed parser
    mixedParser.flush();

    // Phase 2: Incremental replay for visual effect
    // If all patches arrived in a burst (e.g. GLM reasoning models),
    // the streaming compiler already has them all but React batched the updates.
    // Replay from scratch with RAF pacing for the visual "building" effect.
    let finalSpec: Spec;

    if (allPatches.length > 0) {
      // Reset compiler and replay patches incrementally for visual effect
      const replayCompiler = createSpecStreamCompiler<Spec>();
      finalSpec = await replayPatchesIncremental(
        allPatches,
        replayCompiler.getResult(),
        onSpecUpdate,
      );
    } else {
      finalSpec = compiler.getResult();
    }

    // Append assistant response to history for multi-turn continuation
    const updatedHistory: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: fullContent },
    ];
    if (finalSpec.root) {
      onComplete(finalSpec, conversationalText, updatedHistory);
    } else {
      onComplete(null, conversationalText, updatedHistory);
    }
  } catch (err) {
    console.error("[generate] error:", err);
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
