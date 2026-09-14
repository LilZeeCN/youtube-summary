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
  const warnings = [];

  if (!value.thesis || points.length < 3) warnings.push("structure");
  if (evidenceCoverage < 0.7) warnings.push("evidence");
  if (duration >= 120 && timelineCoverage < 0.5) warnings.push("timeline");
  if (hasRepetition(points)) warnings.push("repetition");

  return {
    pass: warnings.length === 0,
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
    timelineCoverage: Number(timelineCoverage.toFixed(2)),
    warnings,
  };
}
