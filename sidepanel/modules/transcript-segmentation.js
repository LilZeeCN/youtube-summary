import { formatTime, parseTimestamp } from "./subtitles.js";

function cueLength(cue) {
  return String(cue?.text || "").length + formatTime(cue?.start).length + 4;
}

export function parseDescriptionChapters(description) {
  const chapters = [];
  for (const rawLine of String(description || "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    const match = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:[-–—·|:]\s*)?(.+)$/);
    if (!match) continue;
    const start = parseTimestamp(match[1]);
    const title = match[2].trim();
    if (start == null || !title) continue;
    chapters.push({ start, title });
  }
  return chapters.sort((a, b) => a.start - b.start);
}

function chapterAtBoundary(chapters, cues, index) {
  if (!cues[index]) return null;
  return chapters.find((chapter) => Math.abs(chapter.start - Number(cues[index].start)) <= 2) || null;
}

function chooseBoundary(cues, start, hardEnd, maxChars, chapters) {
  let consumed = 0;
  const consumedBefore = new Map();
  for (let index = start; index < hardEnd; index++) {
    consumed += cueLength(cues[index]);
    consumedBefore.set(index + 1, consumed);
  }

  const minimumUsefulSize = maxChars * 0.45;
  const candidates = [];
  for (let index = start + 1; index <= hardEnd; index++) {
    const size = consumedBefore.get(index) || 0;
    if (size < minimumUsefulSize) continue;
    const chapter = chapterAtBoundary(chapters, cues, index);
    if (chapter) {
      candidates.push({ index, reason: "chapter", chapter, distance: Math.abs(maxChars - size) });
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0];
  }

  let pause = null;
  for (let index = start + 1; index <= hardEnd; index++) {
    const size = consumedBefore.get(index) || 0;
    if (size < minimumUsefulSize || !cues[index]) continue;
    const previous = cues[index - 1];
    const previousEnd = Number(previous.start) + Math.max(0, Number(previous.duration) || 0);
    const gap = Number(cues[index].start) - previousEnd;
    if (gap >= 8 && (!pause || gap > pause.gap)) pause = { index, reason: "pause", gap };
  }
  return pause || { index: hardEnd, reason: "length" };
}

export function segmentTranscript(
  cues,
  { maxChars = 14000, description = "", overlapCues = 2 } = {}
) {
  if (!Array.isArray(cues) || !cues.length) return [];
  const chapters = parseDescriptionChapters(description);
  const chunks = [];
  let start = 0;

  while (start < cues.length) {
    let hardEnd = start;
    let length = 0;
    while (hardEnd < cues.length) {
      const nextLength = cueLength(cues[hardEnd]);
      if (hardEnd > start && length + nextLength > maxChars) break;
      length += nextLength;
      hardEnd += 1;
    }

    if (hardEnd >= cues.length) {
      const visibleStart = Math.max(0, start - overlapCues);
      chunks.push({
        cues: cues.slice(visibleStart),
        start: Number(cues[start].start) || 0,
        end: Number(cues[cues.length - 1].start) || 0,
        overlapCount: start - visibleStart,
        boundaryReason: "end",
        nextChapterTitle: "",
      });
      break;
    }

    const boundary = chooseBoundary(cues, start, hardEnd, maxChars, chapters);
    const end = Math.max(start + 1, boundary.index);
    const visibleStart = Math.max(0, start - overlapCues);
    chunks.push({
      cues: cues.slice(visibleStart, end),
      start: Number(cues[start].start) || 0,
      end: Number(cues[end]?.start) || Number(cues[end - 1]?.start) || 0,
      overlapCount: start - visibleStart,
      boundaryReason: boundary.reason,
      nextChapterTitle: boundary.chapter?.title || "",
    });
    start = end;
  }

  return chunks;
}
