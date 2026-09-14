// 总结流程编排：短视频一次完成；长字幕自动 map-reduce（分段摘要 → 汇总）

import { chatStream } from "./api.js";
import * as prompts from "./prompts.js";
import { formatTime, cuesToPromptText } from "./subtitles.js";
import { applyTerminologyGuide, normalizeTerminologyGuide } from "./terminology.js";
import { normalizeSummaryDocument, parseSummaryResponse } from "./summary-document.js";
import { segmentTranscript } from "./transcript-segmentation.js";
import { inferVideoType, summaryExtraSpec } from "./video-type.js";
import { buildMemoryContext } from "./memory.js";

// 保守阈值：约等于主流模型 8k~16k token 的安全输入量（中文约 1 字符 = 1 token）
const CHUNK_THRESHOLD = 18000;
const CHUNK_SIZE = 14000;
const TERMINOLOGY_SAMPLE_SIZE = 12000;

// 从视频头到尾均匀取样，既控制术语识别请求大小，也避免只看到开头几分钟。
function representativeTranscriptSample(cues, fullText, maxChars) {
  if (fullText.length <= maxChars) return fullText;
  const stride = Math.max(2, Math.ceil(fullText.length / maxChars));
  const sampled = [];
  for (let i = 0; i < cues.length; i += stride) sampled.push(cues[i]);
  if (sampled[sampled.length - 1] !== cues[cues.length - 1]) sampled.push(cues[cues.length - 1]);
  return cuesToPromptText(sampled).slice(0, maxChars);
}

async function buildTerminologyGuide({ settings, title, description, cues, fullText, signal, chat }) {
  const sample = representativeTranscriptSample(cues, fullText, TERMINOLOGY_SAMPLE_SIZE);
  try {
    const guide = await chat({
      settings,
      messages: [
        { role: "system", content: prompts.terminologySystemPrompt() },
        { role: "user", content: prompts.terminologyUserPrompt(sample, title, description) },
      ],
      signal,
      temperature: 0.1,
    });
    return normalizeTerminologyGuide(guide, title);
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    // 术语预检失败不应阻断整个总结；分块仍可依靠标题和纠错规则继续。
    return "无（请优先采用视频标题中的专有名称）";
  }
}

export async function generateSummary({
  settings,
  videoId,
  title,
  duration,
  cues,
  description,
  memoryContext,
  onDelta,
  onStage,
  signal,
  chat = chatStream,
}) {
  const fullText = cuesToPromptText(cues);
  const videoType = inferVideoType({
    title,
    description,
    transcriptSample: fullText.slice(0, 5000),
  });
  const extraSpec = summaryExtraSpec(videoType);
  // 调用方未传时（如自动总结）在内部补一次记忆检索；显式传 null 表示本次禁用记忆
  const memory = memoryContext === undefined
    ? await buildMemoryContext({
        settings,
        videoId,
        title,
        description,
        transcriptSample: fullText.slice(0, 4000),
      })
    : memoryContext;
  const memoryBlock = prompts.memoryContextBlock(memory);

  if (fullText.length <= CHUNK_THRESHOLD) {
    if (onStage) onStage("正在分析字幕，等待模型开始输出…");
    const raw = await chat({
      settings,
      messages: [
        { role: "system", content: prompts.summarySystemPrompt(videoType, extraSpec, !!memoryBlock) },
        {
          role: "user",
          content: prompts.summaryUserPrompt(fullText, title, duration, description, videoType, memoryBlock),
        },
      ],
      onDelta,
      signal,
      temperature: 0.2,
    });
    return parseSummaryResponse(raw, { cues });
  }

  const chunks = segmentTranscript(cues, {
    maxChars: CHUNK_SIZE,
    description,
    overlapCues: 2,
  });
  if (onStage) onStage("正在识别并统一全片术语…");
  const terminologyGuide = await buildTerminologyGuide({
    settings,
    title,
    description,
    cues,
    fullText,
    signal,
    chat,
  });
  if (onStage) {
    onStage(
      "术语已统一，正在准备分段总结…",
      terminologyGuide === "无" ? "未发现需要统一的术语" : terminologyGuide
    );
  }
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onStage) onStage(`字幕较长，分段总结中（${i + 1}/${chunks.length}）…`);
    const rawPart = await chat({
      settings,
      messages: [
        { role: "system", content: prompts.chunkSystemPrompt() },
        {
          role: "user",
          content: prompts.chunkUserPrompt(
            cuesToPromptText(chunks[i].cues),
            i + 1,
            chunks.length,
            title,
            terminologyGuide
          ),
        },
      ],
      signal,
      temperature: 0.2,
    });
    const part = applyTerminologyGuide(rawPart, terminologyGuide);
    parts.push(`（第 ${i + 1}/${chunks.length} 部分）\n${part}`);
  }

  if (onStage) onStage("正在汇总成最终总结…");
  const summary = await chat({
    settings,
    messages: [
      { role: "system", content: prompts.reduceSystemPrompt(videoType, extraSpec, !!memoryBlock) },
      {
        role: "user",
        content: prompts.reduceUserPrompt(parts.join("\n\n"), title, terminologyGuide, videoType, memoryBlock),
      },
    ],
    onDelta: onDelta
      ? (full) => onDelta(applyTerminologyGuide(full, terminologyGuide))
      : undefined,
    signal,
    temperature: 0.2,
  });
  if (onStage) onStage(null);
  return parseSummaryResponse(applyTerminologyGuide(summary, terminologyGuide), { cues });
}

function parseRefinedText(raw) {
  const text = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.text || "").trim();
  } catch {
    return "";
  }
}

export async function refineSummaryPoint({
  settings,
  title,
  document,
  pointId,
  cues = [],
  signal,
  chat = chatStream,
}) {
  const normalized = normalizeSummaryDocument(document, { cues });
  const point = normalized.keyPoints.find((item) => item.id === pointId);
  if (!point) throw new Error("找不到要优化的关键要点");
  const nearby = point.evidence.length
    ? point.evidence
    : cues.filter((cue) => Math.abs(Number(cue.start) - point.timestamp) <= 90).slice(0, 8);
  const evidenceText = cuesToPromptText(nearby);
  const raw = await chat({
    settings,
    messages: [
      { role: "system", content: prompts.refinePointSystemPrompt() },
      {
        role: "user",
        content: prompts.refinePointUserPrompt({
          videoTitle: title,
          thesis: normalized.thesis,
          pointText: point.text,
          evidenceText,
        }),
      },
    ],
    signal,
    temperature: 0.15,
  });
  const refinedText = parseRefinedText(raw);
  if (!refinedText) throw new Error("模型没有返回可用的优化结果");
  return {
    ...normalized,
    keyPoints: normalized.keyPoints.map((item) =>
      item.id === pointId ? { ...item, text: refinedText } : item
    ),
  };
}

export { formatTime };
