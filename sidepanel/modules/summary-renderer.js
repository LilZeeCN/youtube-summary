import { normalizeSummaryDocument } from "./summary-document.js";
import { formatTime } from "./subtitles.js";
import { videoTypeLabel } from "./video-type.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timestampButton(seconds, className = "") {
  return `<button class="ts${className ? ` ${className}` : ""}" data-t="${Number(seconds) || 0}" type="button">${escapeHtml(formatTime(seconds))}</button>`;
}

function renderPoint(point, index) {
  const id = escapeHtml(point.id);
  const evidenceToggle = point.evidence.length
    ? `<button class="summary-evidence-toggle" data-evidence-toggle="${id}" type="button" aria-expanded="false">
        <span>查看字幕依据</span><span class="summary-evidence-count">${point.evidence.length}</span>
      </button>`
    : "";
  const evidencePanel = point.evidence.length
    ? `<div class="summary-evidence hidden" data-evidence="${id}">
        ${point.evidence
          .map(
            (item) => `<div class="summary-evidence-row">
              ${timestampButton(item.start, "summary-evidence-time")}
              <p>${escapeHtml(item.text)}</p>
            </div>`
          )
          .join("")}
      </div>`
    : "";

  return `<article class="summary-point">
    <div class="summary-point-rail">
      <span class="summary-point-number">${String(index + 1).padStart(2, "0")}</span>
      ${timestampButton(point.timestamp)}
    </div>
    <div class="summary-point-body">
      <p>${escapeHtml(point.text)}</p>
      <div class="summary-point-tools">
        <div class="summary-point-actions">
          ${evidenceToggle}
          <button class="summary-refine" data-summary-refine="${id}" type="button" title="只重新组织这一条，不重新生成整篇">优化此条</button>
        </div>
        ${evidencePanel}
      </div>
    </div>
  </article>`;
}

function renderChapter(chapter) {
  return `<article class="summary-chapter">
    <div class="summary-chapter-marker" aria-hidden="true"></div>
    <div class="summary-chapter-body">
      <div class="summary-chapter-title">${timestampButton(chapter.timestamp)}<h4>${escapeHtml(chapter.title)}</h4></div>
      <p>${escapeHtml(chapter.summary)}</p>
    </div>
  </article>`;
}

export function renderSummaryDocument(document) {
  const value = normalizeSummaryDocument(document);
  const points = value.keyPoints.map(renderPoint).join("");
  const chapters = value.chapters.map(renderChapter).join("");
  const extras = value.extras
    ? `<section class="summary-section summary-extra">
        <div class="summary-section-heading"><span>03</span><h3>${escapeHtml(value.extras.title)}</h3></div>
        <ul>${value.extras.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>`
    : "";

  return `<div class="summary-doc">
    <header class="summary-hero">
      <div class="summary-eyebrow"><span>${escapeHtml(videoTypeLabel(value.videoType))}</span><span>核心结论</span></div>
      <p class="summary-thesis">${escapeHtml(value.thesis || "暂时没有提取到明确结论。")}</p>
    </header>
    ${points ? `<section class="summary-section">
      <div class="summary-section-heading"><span>01</span><h3>关键要点</h3></div>
      <div class="summary-points">${points}</div>
    </section>` : ""}
    ${chapters ? `<section class="summary-section">
      <div class="summary-section-heading"><span>02</span><h3>内容脉络</h3></div>
      <div class="summary-chapters">${chapters}</div>
    </section>` : ""}
    ${extras}
  </div>`;
}
