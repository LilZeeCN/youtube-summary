import { normalizeSummaryDocument } from "./summary-document.js";

function canonicalText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function hasRepetition(points) {
  const texts = points.map((point) => canonicalText(point.text)).filter(Boolean);
  return texts.some((text, index) =>
    texts.slice(index + 1).some((other) => text === other || (text.length > 10 && other.includes(text)))
  );
}

// 空话要点：只复述「视频做了什么」而不给出具体内容的表述。
const VAGUE_PATTERNS = [
  /(介绍|讲解|阐述|说明|分析|分享|提到|讨论|回顾|展示|演示)了/,
  /(非常|十分|很|挺|比较)?(重要|关键|核心)(的)?(内容|部分|知识点|概念)/,
  /值得(一看|一听|关注|注意)/,
];

function looksVague(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  // 带数字、英文术语或引语的要点默认视为具体内容。
  if (/[0-9]/.test(raw) || /[A-Za-z]/.test(raw) || /["“”«»「」『』]/.test(raw)) return false;
  return VAGUE_PATTERNS.some((pattern) => pattern.test(raw));
}

// 要点被章节摘要整句照抄：章节摘要应当综合，而不是复述某条要点原文。
function hasPointChapterOverlap(points, chapters) {
  const pointTexts = points
    .map((point) => canonicalText(point.text))
    .filter((text) => text.length >= 15);
  const chapterTexts = chapters
    .map((chapter) => canonicalText(`${chapter.title || ""}${chapter.summary || ""}`))
    .filter(Boolean);
  return pointTexts.some((pointText) =>
    chapterTexts.some((chapterText) => chapterText === pointText || chapterText.includes(pointText))
  );
}

// 跨度 10 分钟以上的章节只有一句话不到的摘要。
function hasThinChapters(chapters, duration) {
  if (!duration || chapters.length < 2) return false;
  const sorted = chapters
    .map((chapter) => ({ timestamp: Number(chapter.timestamp), summary: canonicalText(chapter.summary) }))
    .filter((chapter) => Number.isFinite(chapter.timestamp) && chapter.timestamp >= 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  return sorted.some((chapter, index) => {
    const end = index + 1 < sorted.length ? sorted[index + 1].timestamp : duration;
    return end - chapter.timestamp >= 600 && chapter.summary.length < 30;
  });
}

export function evaluateSummaryQuality(document, { duration = 0 } = {}) {
  const value = normalizeSummaryDocument(document);
  const points = value.keyPoints;
  const evidenceCount = points.filter((point) => point.evidence.length > 0).length;
  const evidenceCoverage = points.length ? evidenceCount / points.length : 0;
  const timestamps = points.map((point) => Number(point.timestamp)).filter(Number.isFinite);
  const timelineCoverage =
    duration > 0 && timestamps.length > 1
      ? Math.min(1, (Math.max(...timestamps) - Math.min(...timestamps)) / duration)
      : 0;
  const vagueCount = points.filter((point) => looksVague(point.text)).length;
  const vagueRatio = points.length ? vagueCount / points.length : 0;
  const warnings = [];

  if (!value.thesis || points.length < 3) warnings.push("structure");
  if (evidenceCoverage < 0.7) warnings.push("evidence");
  if (duration >= 120 && timelineCoverage < 0.5) warnings.push("timeline");
  if (hasRepetition(points)) warnings.push("repetition");
  if (points.length && vagueRatio >= 0.34) warnings.push("vagueness");
  if (hasPointChapterOverlap(points, value.chapters)) warnings.push("overlap");
  if (hasThinChapters(value.chapters, duration)) warnings.push("chapterDepth");

  return {
    pass: warnings.length === 0,
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
    timelineCoverage: Number(timelineCoverage.toFixed(2)),
    vagueRatio: Number(vagueRatio.toFixed(2)),
    warnings,
  };
}
