import { chatStream } from "./api.js";
import * as prompts from "./prompts.js";
import { cuesToPromptText } from "./subtitles.js";

const DIRECT_THRESHOLD = 16000;
const CHUNK_SIZE = 11000;

function splitCues(cues, maxChars) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const cue of cues) {
    const lineLength = String(cue.text || "").length + 10;
    if (current.length && length + lineLength > maxChars) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(cue);
    length += lineLength;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function generateDeepRead({
  settings,
  title,
  duration,
  summary,
  cues,
  onStage,
  onDelta,
  signal,
}) {
  const fullText = cuesToPromptText(cues);
  if (fullText.length <= DIRECT_THRESHOLD) {
    if (onStage) onStage("正在精读字幕并提取概念与方法…", "已有总结确定结构 · 完整字幕补充细节");
    return chatStream({
      settings,
      messages: [
        { role: "system", content: prompts.deepReadSystemPrompt() },
        {
          role: "user",
          content: prompts.deepReadUserPrompt(summary, fullText, title, duration),
        },
      ],
      onDelta,
      signal,
      temperature: 0.2,
    });
  }

  const chunks = splitCues(cues, CHUNK_SIZE);
  const drafts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onStage) {
      onStage(
        `正在提取章节细节（${i + 1}/${chunks.length}）…`,
        "概念 · 原理 · 步骤 · 例子 · 易错点"
      );
    }
    const draft = await chatStream({
      settings,
      messages: [
        { role: "system", content: prompts.deepReadChunkSystemPrompt() },
        {
          role: "user",
          content: prompts.deepReadChunkUserPrompt(
            summary,
            cuesToPromptText(chunks[i]),
            i + 1,
            chunks.length,
            title
          ),
        },
      ],
      signal,
      temperature: 0.15,
    });
    drafts.push(`（第 ${i + 1}/${chunks.length} 段）\n${draft}`);
  }

  if (onStage) onStage("正在组织完整精读文章…", `已完成 ${chunks.length} 段细节提取`);
  return chatStream({
    settings,
    messages: [
      { role: "system", content: prompts.deepReadReduceSystemPrompt() },
      {
        role: "user",
        content: prompts.deepReadReduceUserPrompt(summary, drafts.join("\n\n"), title),
      },
    ],
    onDelta,
    signal,
    temperature: 0.2,
  });
}
