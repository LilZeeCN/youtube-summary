import { formatTime, parseTimestamp } from "./subtitles.js";

export const SUMMARY_DOCUMENT_VERSION = 5;

const VIDEO_TYPES = new Set(["tutorial", "interview", "review", "lecture", "news", "general"]);
const CONNECTION_RELATIONS = new Set(["印证", "对比", "延伸", "矛盾"]);

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .trim();
}

function timestampSeconds(value) {
  if (Number.isFinite(value)) return Math.max(0, Number(value));
  const match = String(value ?? "").match(/(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?/);
  return match ? parseTimestamp(match[1]) : null;
}

function nearestCue(cues, seconds) {
  if (!Array.isArray(cues) || !cues.length || !Number.isFinite(seconds)) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  cues.forEach((cue, index) => {
    const distance = Math.abs(Number(cue.start) - seconds);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return { cue: cues[bestIndex], index: bestIndex };
}

function normalizeTimestamp(value, cues) {
  const seconds = timestampSeconds(value);
  if (!Number.isFinite(seconds)) return 0;
  const nearest = nearestCue(cues, seconds);
  return nearest ? Math.max(0, Number(nearest.cue.start) || 0) : seconds;
}

function cleanEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .map((item) => ({
      start: timestampSeconds(item?.start) ?? 0,
      text: cleanText(item?.text),
    }))
    .filter((item) => item.text);
}

function evidenceNear(cues, seconds) {
  const nearest = nearestCue(cues, seconds);
  if (!nearest) return [];
  let excerpt = cues.slice(nearest.index, nearest.index + 2);
  if (excerpt.length < 2 && nearest.index > 0) excerpt = cues.slice(nearest.index - 1, nearest.index + 1);
  return excerpt
    .map((cue) => ({ start: Math.max(0, Number(cue.start) || 0), text: cleanText(cue.text) }))
    .filter((cue) => cue.text);
}

function normalizeExtras(value) {
  if (!value || typeof value !== "object") return null;
  const title = cleanText(value.title);
  const items = Array.isArray(value.items) ? value.items.map(cleanText).filter(Boolean) : [];
  return title && items.length ? { title, items } : null;
}

function normalizeSelfTest(value, cues) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      id: cleanText(item?.id) || `quiz-${index + 1}`,
      timestamp: normalizeTimestamp(item?.timestamp, cues),
      question: cleanText(item?.question),
      answer: cleanText(item?.answer),
    }))
    .filter((item) => item.question);
}

function normalizeConnections(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      videoId: cleanText(item?.videoId),
      videoTitle: cleanText(item?.videoTitle),
      relation: CONNECTION_RELATIONS.has(item?.relation) ? item.relation : "关联",
      text: cleanText(item?.text),
    }))
    .filter((item) => item.videoId && item.text);
}

function normalizeSuggestedQuestions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => cleanText(typeof item === "string" ? item : item?.question).slice(0, 60))
    .filter((question) => {
      if (!question) return false;
      const key = canonicalQuestion(question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function canonicalQuestion(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function normalizeObject(value, cues) {
  const keyPoints = Array.isArray(value.keyPoints)
    ? value.keyPoints
        .map((point, index) => {
          const timestamp = normalizeTimestamp(point?.timestamp, cues);
          const existingEvidence = cleanEvidence(point?.evidence);
          return {
            id: cleanText(point?.id) || `point-${index + 1}`,
            timestamp,
            text: cleanText(point?.text),
            evidence: existingEvidence.length ? existingEvidence : evidenceNear(cues, timestamp),
          };
        })
        .filter((point) => point.text)
    : [];

  const chapters = Array.isArray(value.chapters)
    ? value.chapters
        .map((chapter, index) => ({
          id: cleanText(chapter?.id) || `chapter-${index + 1}`,
          timestamp: normalizeTimestamp(chapter?.timestamp, cues),
          title: cleanText(chapter?.title),
          summary: cleanText(chapter?.summary),
        }))
        .filter((chapter) => chapter.title || chapter.summary)
    : [];

  return {
    version: SUMMARY_DOCUMENT_VERSION,
    videoType: VIDEO_TYPES.has(value.videoType) ? value.videoType : "general",
    thesis: cleanText(value.thesis),
    keyPoints,
    chapters,
    extras: normalizeExtras(value.extras),
    selfTest: normalizeSelfTest(value.selfTest, cues),
    connections: normalizeConnections(value.connections),
    suggestedQuestions: normalizeSuggestedQuestions(value.suggestedQuestions),
  };
}

function parseLegacyMarkdown(markdown) {
  const lines = cleanText(markdown).split("\n");
  const value = { videoType: "general", thesis: "", keyPoints: [], chapters: [], extras: null };
  let section = "";
  let currentChapter = null;
  const thesisLines = [];

  const flushChapter = () => {
    if (!currentChapter) return;
    currentChapter.summary = cleanText(currentChapter.summaryLines.join("\n"));
    delete currentChapter.summaryLines;
    value.chapters.push(currentChapter);
    currentChapter = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+一句话总结/.test(line)) {
      flushChapter();
      section = "thesis";
      continue;
    }
    if (/^##\s+关键要点/.test(line)) {
      flushChapter();
      section = "points";
      continue;
    }
    if (/^##\s+章节摘要/.test(line)) {
      flushChapter();
      section = "chapters";
      continue;
    }
    const chapterMatch = line.match(/^###\s+\[([^\]]+)\]\s*(.*)$/);
    if (section === "chapters" && chapterMatch) {
      flushChapter();
      currentChapter = {
        timestamp: chapterMatch[1],
        title: cleanText(chapterMatch[2]),
        summaryLines: [],
      };
      continue;
    }
    const pointMatch = line.match(/^[-*]\s+\[([^\]]+)\]\s*(.+)$/);
    if (section === "points" && pointMatch) {
      value.keyPoints.push({ timestamp: pointMatch[1], text: cleanText(pointMatch[2]) });
      continue;
    }
    if (section === "thesis" && line && !line.startsWith("#")) thesisLines.push(line);
    if (section === "chapters" && currentChapter && line) currentChapter.summaryLines.push(line);
  }
  flushChapter();
  value.thesis = cleanText(thesisLines.join(" "));

  if (!value.thesis) {
    value.thesis = cleanText(lines.find((line) => line.trim() && !line.trim().startsWith("#")) || "");
  }
  return value;
}

function parseJsonResponse(raw) {
  const text = cleanText(raw);
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function normalizeSummaryDocument(value, { cues = [] } = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeObject(value, cues);
  }
  return normalizeObject(parseLegacyMarkdown(value), cues);
}

export function parseSummaryResponse(raw, { cues = [] } = {}) {
  const parsed = parseJsonResponse(raw);
  return normalizeSummaryDocument(parsed || raw, { cues });
}

export function summaryDocumentToMarkdown(document) {
  const value = normalizeSummaryDocument(document);
  const blocks = ["## 一句话总结", value.thesis || "（暂无总结）"];

  if (value.keyPoints.length) {
    blocks.push(
      "## 关键要点",
      value.keyPoints.map((point) => `- [${formatTime(point.timestamp)}] ${point.text}`).join("\n")
    );
  }

  if (value.chapters.length) {
    blocks.push(
      "## 章节摘要",
      value.chapters
        .map(
          (chapter) =>
            `### [${formatTime(chapter.timestamp)}] ${chapter.title}\n${chapter.summary}`.trim()
        )
        .join("\n\n")
    );
  }

  if (value.extras) {
    blocks.push(
      `## ${value.extras.title}`,
      value.extras.items.map((item) => `- ${item}`).join("\n")
    );
  }

  if (value.selfTest.length) {
    blocks.push(
      "## 自测问题",
      value.selfTest
        .map(
          (item) =>
            `- [${formatTime(item.timestamp)}] ${item.question}\n  - 答案：${item.answer || "回到视频对应位置确认"}`
        )
        .join("\n")
    );
  }

  if (value.connections.length) {
    blocks.push(
      "## 关联视频",
      value.connections
        .map(
          (item) =>
            `- 【${item.relation}】${item.text}（${item.videoTitle ? `《${item.videoTitle}》` : item.videoId}）`
        )
        .join("\n")
    );
  }

  return blocks.filter(Boolean).join("\n\n");
}
