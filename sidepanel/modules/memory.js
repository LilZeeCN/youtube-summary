// 长期记忆层。三层设计（对齐业界主流架构）：
//   画像 facts   —— 关于用户的离散事实（ChatGPT saved memories 式：自动更新、用户可增删）
//   主题 topics  —— 跨视频的主题条目与演进笔记（Zep 实体图谱的轻量 JSON 版）
//   情景 episodes —— 已总结视频的档案，直接复用历史缓存，不另存副本
//                   （ChatGPT reference chat history 式，但用确定性的本地检索）
// 读取：总结前本地词法检索 top-K 相关视频 + 相关主题 + 画像，注入提示词。
// 写入：总结完成后异步一次「睡眠期整合」调用重写记忆（Letta sleep-time compute 式），
//       不阻塞用户、失败即放弃（记忆保持原样）。
// 全部数据只存 chrome.storage.local，仅在你配置的 AI 接口请求中随提示词发送。

import * as prompts from "./prompts.js";
import { chatStream } from "./api.js";
import { cacheSummaries } from "./store.js";

const MEMORY_KEY = "memory";

export const MEMORY_LIMITS = {
  facts: 24,
  topics: 60,
  factChars: 160,
  nameChars: 40,
  noteChars: 240,
  aliases: 4,
  videoIdsPerTopic: 30,
  relatedVideos: 3,
  relatedTopics: 4,
  minRelatedScore: 0.08,
};

function clean(value) {
  return String(value ?? "").trim();
}

function canonical(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

// 内容哈希做稳定 id：整合重写后 id 不漂移，设置页的删除操作不会失效
function stableId(prefix, text) {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `${prefix}-${hash.toString(36)}`;
}

export function normalizeMemory(value) {
  const raw = value && typeof value === "object" ? value : {};
  const seenFact = new Set();
  const facts = (Array.isArray(raw.facts) ? raw.facts : [])
    .map((fact) => clean(fact?.text ?? fact).slice(0, MEMORY_LIMITS.factChars))
    .filter((text) => {
      if (!text) return false;
      const key = canonical(text);
      if (seenFact.has(key)) return false;
      seenFact.add(key);
      return true;
    })
    .slice(0, MEMORY_LIMITS.facts)
    .map((text) => ({ id: stableId("fact", text), text }));

  const seenTopic = new Map();
  for (const topic of Array.isArray(raw.topics) ? raw.topics : []) {
    const name = clean(topic?.name).slice(0, MEMORY_LIMITS.nameChars);
    if (!name) continue;
    const key = canonical(name);
    if (seenTopic.has(key)) {
      // 同名条目（整合时模型重复输出）合并：保留更长的 note 与并集 videoIds
      const existing = seenTopic.get(key);
      if (clean(topic.note).length > existing.note.length) existing.note = clean(topic.note);
      existing.videoIds = [...new Set([...existing.videoIds, ...(topic.videoIds || [])])];
      continue;
    }
    seenTopic.set(key, {
      name,
      aliases: (Array.isArray(topic?.aliases) ? topic.aliases : [])
        .map(clean)
        .filter(Boolean)
        .slice(0, MEMORY_LIMITS.aliases),
      note: clean(topic?.note).slice(0, MEMORY_LIMITS.noteChars),
      videoIds: [...new Set((Array.isArray(topic?.videoIds) ? topic.videoIds : []).map(clean).filter(Boolean))]
        .slice(0, MEMORY_LIMITS.videoIdsPerTopic),
    });
  }
  const topics = [...seenTopic.values()].slice(0, MEMORY_LIMITS.topics)
    .map((topic) => ({ id: stableId("topic", topic.name), ...topic }));

  return { version: 1, facts, topics, updatedAt: Number(raw.updatedAt) || 0 };
}

export async function loadMemory() {
  const obj = await chrome.storage.local.get(MEMORY_KEY);
  return normalizeMemory(obj[MEMORY_KEY]);
}

export async function saveMemory(memory) {
  const value = normalizeMemory(memory);
  value.updatedAt = Date.now();
  await chrome.storage.local.set({ [MEMORY_KEY]: value });
  return value;
}

export async function clearMemory() {
  await chrome.storage.local.remove(MEMORY_KEY);
  return normalizeMemory(null);
}

export async function deleteMemoryEntry(id) {
  const memory = await loadMemory();
  const next = {
    ...memory,
    facts: memory.facts.filter((fact) => fact.id !== id),
    topics: memory.topics.filter((topic) => topic.id !== id),
  };
  return saveMemory(next);
}

// —— 本地词法检索（中文二元组 + 拉丁词的 TF 余弦；不依赖 embedding 接口，结果可测试） ——

export function tokenize(text) {
  const raw = String(text || "").toLowerCase();
  const tokens = [];
  for (const match of raw.matchAll(/[a-z0-9][a-z0-9'+.#-]{1,}/g)) tokens.push(match[0]);
  const segments = raw.match(/[\u4e00-\u9fff\u3040-\u30ff]+/g) || [];
  for (const segment of segments) {
    if (segment.length === 1) {
      tokens.push(segment);
      continue;
    }
    for (let i = 0; i + 1 < segment.length; i++) tokens.push(segment.slice(i, i + 2));
  }
  return tokens;
}

function termFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

export function cosineSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const countsA = termFrequency(tokensA);
  const countsB = termFrequency(tokensB);
  let dot = 0;
  for (const [token, count] of countsA) {
    dot += count * (countsB.get(token) || 0);
  }
  const norm = (counts) => Math.sqrt([...counts.values()].reduce((sum, count) => sum + count * count, 0));
  return dot / (norm(countsA) * norm(countsB)) || 0;
}

function videoSearchText(video) {
  return [video.title, video.thesis, ...(video.chapterTitles || [])].join("\n");
}

export function rankRelatedVideos(queryText, videos, { limit = MEMORY_LIMITS.relatedVideos, minScore = MEMORY_LIMITS.minRelatedScore, excludeVideoId = "" } = {}) {
  const queryTokens = tokenize(queryText);
  if (!queryTokens.length) return [];
  return videos
    .filter((video) => video.videoId && video.videoId !== excludeVideoId && (video.title || video.thesis))
    .map((video) => ({ video, score: cosineSimilarity(queryTokens, tokenize(videoSearchText(video))) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ video, score }) => ({
      videoId: video.videoId,
      title: video.title,
      thesis: video.thesis,
      videoType: video.videoType,
      ts: video.ts,
      score: Number(score.toFixed(3)),
    }));
}

export function findRelevantTopics(queryText, topics, { limit = MEMORY_LIMITS.relatedTopics, minScore = MEMORY_LIMITS.minRelatedScore } = {}) {
  const queryTokens = tokenize(queryText);
  if (!queryTokens.length) return [];
  return topics
    .map((topic) => ({
      topic,
      score: cosineSimilarity(queryTokens, tokenize([topic.name, ...topic.aliases, topic.note].join("\n"))),
    }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ topic }) => ({ name: topic.name, note: topic.note }));
}

// 总结前的读取路径：画像 + 相关视频 + 相关主题。关闭记忆或检索为空时返回 null。
export async function buildMemoryContext({ settings, videoId, title, description, transcriptSample = "" }) {
  if (!settings || settings.memoryEnabled === false) return null;
  const [memory, videos] = await Promise.all([loadMemory(), cacheSummaries()]);
  const queryText = [title, description, String(transcriptSample || "").slice(0, 4000)]
    .filter(Boolean)
    .join("\n");
  const relatedVideos = rankRelatedVideos(queryText, videos, { excludeVideoId: videoId });
  const topics = findRelevantTopics(queryText, memory.topics);
  if (!memory.facts.length && !relatedVideos.length && !topics.length) return null;
  return {
    facts: memory.facts.map((fact) => fact.text),
    relatedVideos,
    topics,
  };
}

// —— 睡眠期整合（写入路径）：fire-and-forget，任何失败都不改现有记忆 ——

function videoDigest(title, document) {
  const doc = document || {};
  const lines = [`《${title}》（${doc.videoType || "general"}）`];
  if (doc.thesis) lines.push(`核心结论：${doc.thesis}`);
  const points = Array.isArray(doc.keyPoints) ? doc.keyPoints.map((point) => point && point.text).filter(Boolean) : [];
  if (points.length) lines.push(`要点：\n${points.slice(0, 8).map((text) => `- ${text}`).join("\n")}`);
  const chapterTitles = Array.isArray(doc.chapters) ? doc.chapters.map((chapter) => chapter && chapter.title).filter(Boolean) : [];
  if (chapterTitles.length) lines.push(`章节：${chapterTitles.join(" / ")}`);
  const extras = doc.extras && Array.isArray(doc.extras.items) ? doc.extras.items : [];
  if (extras.length) lines.push(`补充（${doc.extras.title || "其他"}）：\n${extras.slice(0, 6).map((item) => `- ${item}`).join("\n")}`);
  return lines.join("\n");
}

function parseMemoryResponse(raw) {
  const text = clean(raw)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function consolidateMemory({ settings, videoId, title, summaryDocument, signal, chat = chatStream }) {
  const memory = await loadMemory();
  const digest = videoDigest(title, summaryDocument);
  try {
    const raw = await chat({
      settings,
      messages: [
        {
          role: "system",
          content: prompts.memoryConsolidationSystemPrompt({
            maxFacts: MEMORY_LIMITS.facts,
            maxTopics: MEMORY_LIMITS.topics,
          }),
        },
        {
          role: "user",
          content: prompts.memoryConsolidationUserPrompt(
            JSON.stringify({ facts: memory.facts.map((f) => f.text), topics: memory.topics }, null, 0),
            `${digest}\n本视频的 videoId：${videoId}`
          ),
        },
      ],
      signal,
      temperature: 0.1,
    });
    const parsed = parseMemoryResponse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const merged = normalizeMemory(parsed);
    merged.updatedAt = Date.now();
    await chrome.storage.local.set({ [MEMORY_KEY]: merged });
    return merged;
  } catch {
    // 整合失败不阻塞、不报错：记忆保持原样，下次总结后再试
    return null;
  }
}

// 对话用的画像摘要：几条稳定事实，控制长度
export async function memoryProfileDigest({ settings, maxFacts = 8 } = {}) {
  if (!settings || settings.memoryEnabled === false) return "";
  const memory = await loadMemory();
  return memory.facts.slice(0, maxFacts).map((fact) => `- ${fact.text}`).join("\n");
}

// 对话读取路径：按当前问题在观看档案里检索相关视频（含要点），供回答时引用
export async function retrieveChatVideos({ settings, query, excludeVideoId = "", limit = 3 } = {}) {
  if (!settings || settings.memoryEnabled === false) return [];
  const videos = await cacheSummaries();
  return rankRelatedVideos(query, videos, { excludeVideoId, limit })
    .map(({ videoId, title, thesis }) => {
      const full = videos.find((video) => video.videoId === videoId);
      return { videoId, title, thesis, keyPoints: (full && full.keyPoints) || [] };
    });
}
