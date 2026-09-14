// 侧边栏主逻辑：视频状态检测 + 五个页面（总结/对话/字幕/导图/设置）的编排

import * as store from "./modules/store.js";
import * as api from "./modules/api.js";
import {
  DEFAULT_CONNECTOR_URL,
  getAntigravityModels,
  getAntigravityStatus,
  pickDefaultAntigravityModel,
} from "./modules/antigravity-api.js";
import * as subs from "./modules/subtitles.js";
import * as prompts from "./modules/prompts.js";
import { generateSummary, refineSummaryPoint } from "./modules/summarize.js";
import { generateDeepRead } from "./modules/deep-read.js";
import { renderMarkdown } from "./modules/markdown.js";
import {
  normalizeSummaryDocument,
  summaryDocumentToMarkdown,
} from "./modules/summary-document.js";
import { renderSummaryDocument } from "./modules/summary-renderer.js";
import { MindMap, parseMindmapJson } from "./modules/mindmap.js";
import {
  SubtitleRequestCoordinator,
  isStaleSubtitleError,
} from "./modules/subtitle-request.js";
import { renderSubtitleTrackSelect } from "./modules/subtitle-track-select.js";
import { validateTimestamps } from "./modules/timestamp-validator.js";
import { applyTheme, observeSystemTheme } from "./modules/theme.js";
import { evaluateSummaryQuality } from "./modules/summary-quality.js";
import { videoUrlFromId, platformFromId } from "./modules/video-link.js";
import {
  loadMemory,
  deleteMemoryEntry,
  clearMemory,
  consolidateMemory,
  memoryProfileDigest,
} from "./modules/memory.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  settings: { ...store.DEFAULT_SETTINGS },
  profiles: [], // 已保存的模型配置
  video: null, // { videoId, title, tracks, pageType, isLive, lengthSeconds }
  cues: null,
  cuesVideoId: null, // 字幕所属视频，防止换视频后用到旧字幕
  cuesSource: null, // { videoId, title, track } 字幕溯源信息
  trackIndex: undefined,
  summary: null,
  deepRead: null,
  summaryMode: "summary",
  chat: [],
  mindmap: null,
  busy: { summary: false, deepRead: false, chat: false, map: false },
  follow: true,
  activeTab: "summary",
  autoRanFor: null,
};

let mapRenderer = null;
let followTimer = null;
let activeSubEl = null;
const subtitleRequests = new SubtitleRequestCoordinator((trackIndex, videoId) =>
  subs.loadSubtitles(trackIndex, videoId)
);

/* ---------------- 通用 UI ---------------- */

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => el.classList.add("out"), 2400);
  setTimeout(() => el.remove(), 2800);
}

function setChip(kind, text, title) {
  $("#chip-dot").dataset.kind = kind; // ok | warn | idle
  $("#chip-text").textContent = text;
  $("#video-chip").title = title || text;
}

/* ---------------- 视频状态 ---------------- */

let refreshSeq = 0;

async function refreshVideo() {
  const seq = ++refreshSeq;
  subtitleRequests.invalidate();
  // 立即失效派生数据：刷新是异步的，窗口期内绝不能继续用旧视频的字幕
  state.cues = null;
  state.cuesVideoId = null;
  state.cuesSource = null;
  renderSubsSource();
  let info = null;
  try {
    info = await subs.getVideoInfo();
  } catch (e) {
    if (seq !== refreshSeq) return; // 已有更新的刷新，丢弃本次
    state.video = null;
    setChip("idle", e.message || "请打开一个 YouTube / B站 视频页签");
    renderSummaryState();
    return;
  }
  if (seq !== refreshSeq) return;
  state.video = info;
  state.cues = null;
  state.trackIndex = undefined;
  state.summary = null;
  state.deepRead = null;
  state.summaryMode = "summary";
  state.chat = [];
  state.mindmap = null;
  $("#subs-list").innerHTML = "";
  $("#track-select").innerHTML = "";
  stopFollow();

  const isWatch = info.pageType === "watch";
  const hasTracks = isWatch && info.tracks && info.tracks.length > 0;

  if (info.pageType === "shorts") {
    setChip("warn", "Shorts 暂不支持");
  } else if (!isWatch) {
    setChip("idle", "打开一个视频后开始");
  } else if (hasTracks) {
    setChip("ok", info.title);
  } else {
    setChip("warn", `${info.title} · 无字幕`);
  }

  // 恢复该视频的缓存
  const [sum, deepRead, chat, map] = await Promise.all([
    store.cacheGet(info.videoId, "summary"),
    store.cacheGet(info.videoId, "deepRead"),
    store.cacheGet(info.videoId, "chat"),
    store.cacheGet(info.videoId, "mindmap"),
  ]);
  if (seq !== refreshSeq) return;
  if (sum && sum.data) state.summary = normalizeSummaryDocument(sum.data);
  if (deepRead && deepRead.data) state.deepRead = deepRead.data;
  if (chat && Array.isArray(chat.data)) state.chat = chat.data;
  if (map && map.data) state.mindmap = map.data;

  renderSummaryState();
  renderChat(false);
  renderMapState();

  // 刷新可能由页面加载完成、页签激活等事件触发；字幕页已经打开时，
  // 必须主动恢复轨道名称与字幕内容，不能等待用户再次点击“字幕”。
  if (state.activeTab === "subs") {
    fillTrackSelect();
    void ensureSubsTab();
  }

  if (
    state.settings.autoSummarize &&
    hasTracks &&
    store.isConfigured(state.settings) &&
    !state.summary &&
    state.autoRanFor !== info.videoId
  ) {
    state.autoRanFor = info.videoId;
    startSummary();
  }
}

function videoReady() {
  return !!(state.video && state.video.pageType === "watch");
}

// 任何事件链都可能漏掉换视频（整页跳转、新页签等），关键动作前与页面强制对齐一次
async function syncVideoIfNeeded() {
  try {
    const info = await subs.getVideoInfo();
    if (!info || !state.video || info.videoId !== state.video.videoId) {
      await refreshVideo();
    }
  } catch (e) {
    await refreshVideo();
  }
}

async function guardAction() {
  await syncVideoIfNeeded();
  if (!store.isConfigured(state.settings)) {
    toast("请先在「设置」中配置 API", "error");
    switchTab("settings");
    return false;
  }
  if (!videoReady()) {
    toast("请先打开一个 YouTube / B站 视频页");
    return false;
  }
  if (state.video.pageType === "watch" && !(state.video.tracks || []).length) {
    toast(state.video.subtitleHint || "该视频没有可用字幕，暂不支持总结", "error");
    return false;
  }
  return true;
}

async function ensureCues() {
  if (state.cues && state.cuesVideoId === state.video?.videoId) return state.cues;
  const res = await subtitleRequests.load(state.video?.videoId, state.trackIndex);
  state.cues = res.cues;
  state.cuesVideoId = res.videoId;
  setCuesSource(res);
  return state.cues;
}

// 记录并展示这批字幕到底来自哪个视频/轨道，出现错位时可立即定位是哪一层的问题
function setCuesSource(res) {
  state.cuesSource = {
    videoId: res.videoId || state.cuesVideoId,
    title: res.title || (state.video && state.video.title) || "",
    track: (res.track && res.track.name) || "",
    count: (res.cues || []).length,
  };
  renderSubsSource();
}

function renderSubsSource() {
  const el = $("#subs-source");
  if (!el) return;
  const s = state.cuesSource;
  if (!s || !state.cues) {
    el.classList.add("hidden");
    return;
  }
  const mismatch =
    state.video && s.videoId && s.videoId !== state.video.videoId;
  el.classList.toggle("mismatch", !!mismatch);
  el.classList.remove("hidden");
  el.innerHTML = mismatch
    ? `⚠ 字幕来自 <b>${escapeHtmlText(s.title)}</b>（${s.videoId}），与当前视频（${escapeHtmlText(
        state.video.title
      )}）<b>不一致</b>，请截图反馈`
    : `字幕来源：<b>${escapeHtmlText(s.title)}</b> · ${escapeHtmlText(s.track)} · ${s.count} 条`;
}

/* ---------------- 页签切换 ---------------- */

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));

  if (name === "subs") {
    ensureSubsTab();
  } else {
    stopFollow();
  }
  if (name === "map" && state.mindmap) {
    renderMindmap(state.mindmap);
  }
  if (name === "history") {
    renderHistory();
  }
}

/* ---------------- 历史页 ---------------- */

const KIND_LABELS = { summary: "总结", deepRead: "精读", chat: "对话", mindmap: "导图" };
const KIND_ORDER = ["summary", "deepRead", "chat", "mindmap"];

async function renderHistory() {
  const list = $("#history-list");
  if (!list) return;
  const query = ($("#history-search").value || "").trim().toLowerCase();
  let items = [];
  try {
    items = await store.cacheList();
  } catch (e) {
    list.innerHTML = emptyRow(e.message || "历史记录读取失败");
    return;
  }
  if (query) {
    items = items.filter(
      (it) =>
        (it.title || "").toLowerCase().includes(query) ||
        (it.videoId || "").toLowerCase().includes(query)
    );
  }
  if (!items.length) {
    list.innerHTML = emptyRow(query ? "没有匹配的记录" : "还没有总结记录，去总结一个视频吧");
    return;
  }
  const trash =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
  list.innerHTML = items
    .map((item) => {
      const when = item.ts
        ? new Date(item.ts).toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      const kinds = KIND_ORDER.filter((k) => item.kinds.includes(k))
        .map((k) => KIND_LABELS[k])
        .join(" · ");
      const platform = platformFromId(item.videoId) === "bilibili" ? "B站" : "YouTube";
      const title = item.title || item.videoId;
      return `<div class="history-row" data-id="${escapeHtmlText(item.videoId)}" data-title="${escapeHtmlText(title)}" title="点击打开原视频并恢复内容">
  <div class="history-info">
    <span class="history-title">${escapeHtmlText(title)}</span>
    <span class="history-meta">${platform}${when ? ` · ${when}` : ""}${kinds ? ` · ${kinds}` : ""}</span>
  </div>
  <button class="icon-btn sm" type="button" data-act="del" title="删除这条记录">${trash}</button>
</div>`;
    })
    .join("");
}

// 点击历史记录：在当前活动页签打开原视频，页面加载完成后 refreshVideo 会自动恢复缓存内容
async function openHistoryVideo(row) {
  const url = videoUrlFromId(row.dataset.id);
  if (!url) return;
  let opened = false;
  try {
    const tab = await subs.getActiveTab();
    if (tab && Number.isInteger(tab.id)) {
      await chrome.tabs.update(tab.id, { url });
      opened = true;
    }
  } catch (e) {}
  if (!opened) chrome.tabs.create({ url });
  toast(`正在打开：${row.dataset.title || row.dataset.id}`);
}

async function ensureSubsTab() {
  await syncVideoIfNeeded();
  if (!videoReady()) {
    $("#subs-list").innerHTML = emptyRow("请先打开一个视频页");
    return;
  }
  if (!(state.video.tracks || []).length) {
    $("#subs-list").innerHTML = emptyRow("该视频没有可用字幕");
    return;
  }
  if (!(state.cues && state.cuesVideoId === state.video.videoId)) {
    $("#subs-list").innerHTML = emptyRow("字幕加载中…");
    try {
      const res = await subtitleRequests.load(state.video.videoId, state.trackIndex);
      state.cues = res.cues;
      state.cuesVideoId = res.videoId;
      state.trackIndex = res.track.index;
      setCuesSource(res);
      fillTrackSelect();
    } catch (e) {
      if (isStaleSubtitleError(e)) return;
      $("#subs-list").innerHTML = emptyRow(e.message);
      return;
    }
  }
  fillTrackSelect();
  renderSubs($("#subs-search").value.trim());
  startFollow();
}

function emptyRow(text) {
  return `<div class="subs-empty">${text}</div>`;
}

function fillTrackSelect() {
  const sel = $("#track-select");
  renderSubtitleTrackSelect(sel, state.video, state.trackIndex);
}

/* ---------------- 字幕页 ---------------- */

function renderSubs(query = "") {
  const list = $("#subs-list");
  const cues = state.cues || [];
  const q = query.toLowerCase();
  const rows = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (q && !c.text.toLowerCase().includes(q)) continue;
    const text = q ? c.text.replace(new RegExp(escapeRe(q), "gi"), (m) => `<mark>${m}</mark>`) : c.text;
    rows.push(
      `<div class="sub-row" data-i="${i}"><span class="ts">${subs.formatTime(c.start)}</span><span class="sub-text">${text}</span></div>`
    );
  }
  list.innerHTML = rows.length ? rows.join("") : emptyRow(q ? "没有匹配的字幕" : "没有字幕");
  activeSubEl = null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startFollow() {
  stopFollow();
  if (!state.follow) return;
  followTimer = setInterval(async () => {
    if (state.activeTab !== "subs" || !state.cues) return;
    const t = await subs.getCurrentTime();
    let idx = -1;
    for (let i = 0; i < state.cues.length; i++) {
      if (state.cues[i].start <= t + 0.2) idx = i;
      else break;
    }
    const el = idx >= 0 ? $(`#subs-list .sub-row[data-i="${idx}"]`) : null;
    if (el && el !== activeSubEl) {
      if (activeSubEl) activeSubEl.classList.remove("active");
      el.classList.add("active");
      activeSubEl = el;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, 500);
}

function stopFollow() {
  if (followTimer) clearInterval(followTimer);
  followTimer = null;
  activeSubEl = null;
}

/* ---------------- 总结页 ---------------- */

// 对话页的一键提问：首条是与播放位置相关的工具型问题，其余按总结个性化生成。
const DEFAULT_CHAT_QUESTIONS = [
  "用更简单的话解释整个视频",
  "列出视频提到的工具/概念",
  "给我出 3 道检验理解的问题",
];

function renderChatSuggestions() {
  const quick = $("#chat-quick");
  if (!quick) return;
  const dynamic = (state.summary && state.summary.suggestedQuestions) || [];
  const questions = ["这一段在讲什么？", ...(dynamic.length ? dynamic : DEFAULT_CHAT_QUESTIONS)];
  quick.innerHTML = questions
    .map((question) => `<button class="chip" type="button">${escapeHtmlText(question)}</button>`)
    .join("");
}

function renderSummaryState() {
  const placeholder = $("#sum-placeholder");
  const md = $("#sum-md");
  const actions = $("#sum-actions");
  renderChatSuggestions();
  if (state.summary) {
    if (state.summaryMode === "deep" && !state.deepRead) state.summaryMode = "summary";
    placeholder.classList.add("hidden");
    md.classList.remove("hidden");
    actions.classList.remove("hidden");
    md.innerHTML =
      state.summaryMode === "deep"
        ? renderMarkdown(state.deepRead)
        : renderSummaryDocument(state.summary);
    $("#sum-mode-switch").classList.toggle("hidden", !state.deepRead);
    document.querySelectorAll("[data-summary-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.summaryMode === state.summaryMode);
      button.setAttribute("aria-selected", String(button.dataset.summaryMode === state.summaryMode));
    });
    $("#btn-deep-read").textContent = state.deepRead ? "重新精读" : "生成精读";
  } else if (state.busy.summary) {
    // 页面刷新事件可能在字幕加载期间再次调用这里；生成态不能退回初始引导。
    placeholder.classList.add("hidden");
    md.classList.remove("hidden");
    actions.classList.add("hidden");
    $("#sum-mode-switch").classList.add("hidden");
  } else {
    placeholder.classList.remove("hidden");
    md.classList.add("hidden");
    actions.classList.add("hidden");
    $("#sum-mode-switch").classList.add("hidden");
    const text = $("#sum-placeholder-text");
    if (state.video && state.video.pageType === "watch") {
      text.textContent = (state.video.tracks || []).length
        ? "提取字幕并让 AI 生成一句话总结、关键要点与章节摘要"
        : state.video.subtitleHint || "该视频没有可用字幕，无法总结";
    } else if (state.video) {
      text.textContent = "打开一个视频后即可总结";
    }
  }
  updateQualityBanner();
}

/* ---------------- 总结质检 ---------------- */

// summary-quality 的产品化：生成与恢复缓存后自动检查，不达标时给出可读提示与重试入口。
// 每次渲染重新计算（纯字符串运算，开销可忽略），缓存里的旧总结也会被同样标准审视。
const QUALITY_MESSAGES = {
  structure: "总结论或要点数量不足",
  evidence: "部分要点缺少字幕依据，可能与原视频不符",
  timeline: "要点时间集中在视频局部，可能遗漏其他段落",
  repetition: "存在内容重复的要点",
  vagueness: "部分要点过于空泛（只写“介绍了什么”而没有具体内容）",
  overlap: "关键要点与章节摘要存在整句重复",
  chapterDepth: "部分长章节的摘要过于单薄",
};

function updateQualityBanner() {
  const banner = $("#sum-quality");
  if (!banner) return;
  const active =
    state.summary &&
    state.summaryMode === "summary" &&
    !state.busy.summary &&
    !state.busy.deepRead;
  if (!active) {
    banner.classList.add("hidden");
    return;
  }
  const q = evaluateSummaryQuality(state.summary, {
    duration: Number(state.video && state.video.lengthSeconds) || 0,
  });
  if (q.pass) {
    banner.classList.add("hidden");
    return;
  }
  const messages = q.warnings.map((w) => QUALITY_MESSAGES[w] || w).join("；");
  banner.innerHTML =
    '<span class="quality-mark" aria-hidden="true">⚠</span>' +
    `<span class="quality-text">质检提示：${escapeHtmlText(messages)}。可重新总结，或换更强的模型。</span>` +
    '<button class="btn ghost sm" type="button" data-quality-retry>立即重试</button>';
  banner.classList.remove("hidden");
}

/* ---------------- 长期记忆管理 ---------------- */

async function renderMemoryPanel() {
  const factsBox = $("#memory-facts");
  const topicsBox = $("#memory-topics");
  if (!factsBox || !topicsBox) return;
  const memory = await loadMemory();
  factsBox.innerHTML = memory.facts.length
    ? memory.facts
        .map(
          (fact) =>
            `<div class="memory-row"><span>${escapeHtmlText(fact.text)}</span><button class="memory-del" data-memory-del="${fact.id}" type="button" title="删除这条记忆">✕</button></div>`
        )
        .join("")
    : `<p class="memory-empty">还没有画像记忆，总结几个视频后会自动积累</p>`;
  topicsBox.innerHTML = memory.topics.length
    ? memory.topics
        .slice(0, 20)
        .map(
          (topic) =>
            `<div class="memory-row memory-topic"><span class="memory-topic-name">${escapeHtmlText(topic.name)}</span><span class="memory-topic-note">${escapeHtmlText(topic.note)}</span><button class="memory-del" data-memory-del="${topic.id}" type="button" title="删除这个主题">✕</button></div>`
        )
        .join("") + (memory.topics.length > 20 ? `<p class="memory-empty">… 共 ${memory.topics.length} 个主题</p>` : "")
    : `<p class="memory-empty">还没有主题积累</p>`;
}

let summaryAbort = null;
let summaryProgressTimer = null;

function setSummaryProgress(message, detail) {
  const stage = $("#sum-stage");
  if (!message) {
    stage.classList.add("hidden");
    return;
  }
  $("#sum-stage-text").textContent = message;
  stage.classList.remove("hidden");
  if (detail !== undefined) {
    $("#sum-stage-detail").textContent = detail || "";
    $("#sum-stage-detail-wrap").classList.toggle("hidden", !detail);
  }
}

function startSummaryClock() {
  const startedAt = Date.now();
  clearInterval(summaryProgressTimer);
  const tick = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    $("#sum-elapsed").textContent = `已运行 ${Math.floor(seconds / 60)}:${String(
      seconds % 60
    ).padStart(2, "0")}`;
  };
  tick();
  summaryProgressTimer = setInterval(tick, 1000);
}

async function startSummary() {
  if (state.busy.summary || state.busy.deepRead) return;
  if (!(await guardAction())) return;
  state.busy.summary = true;
  summaryAbort = new AbortController();

  const btn = $("#btn-summarize");
  const regenBtn = $("#btn-regen");
  const deepReadBtn = $("#btn-deep-read");
  btn.disabled = true;
  btn.textContent = "总结中…";
  regenBtn.disabled = true;
  regenBtn.textContent = "生成中…";
  deepReadBtn.disabled = true;
  $("#sum-stage-detail").textContent = "";
  $("#sum-stage-detail-wrap").classList.add("hidden");
  setSummaryProgress("正在读取并校验字幕…");
  startSummaryClock();
  $("#sum-md").classList.remove("hidden");
  $("#sum-md").innerHTML = "";
  $("#sum-placeholder").classList.add("hidden");

  try {
    const cues = await ensureCues();
    const document = await generateSummary({
      settings: state.settings,
      videoId: state.video.videoId,
      title: state.video.title,
      duration: Number(state.video.lengthSeconds) || 0,
      description: state.video.description || "",
      cues,
      signal: summaryAbort.signal,
      onStage: (message, detail) => setSummaryProgress(message, detail),
      onDelta: (full) => {
        setSummaryProgress(`正在生成最终内容…（${full.length} 字）`);
      },
    });
    state.summary = document;
    state.deepRead = null;
    state.summaryMode = "summary";
    await store.cacheSet(state.video.videoId, "summary", {
      data: document,
      title: state.video.title,
    });
    await store.cacheRemove(state.video.videoId, "deepRead");
    if (state.settings.memoryEnabled) {
      // 睡眠期整合：后台静默更新长期记忆，不阻塞总结流程，失败自动放弃
      void consolidateMemory({
        settings: state.settings,
        videoId: state.video.videoId,
        title: state.video.title,
        summaryDocument: document,
      }).then(() => renderMemoryPanel());
    }
    $("#sum-meta").textContent = `${currentModelLabel()} · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    $("#sum-actions").classList.remove("hidden");
    renderSummaryState();
    toast("总结完成", "success");
  } catch (e) {
    if (e && e.name === "AbortError") {
      toast("已停止生成");
    } else {
      toast(e.message || "总结失败", "error");
    }
    renderSummaryState();
  } finally {
    state.busy.summary = false;
    summaryAbort = null;
    clearInterval(summaryProgressTimer);
    summaryProgressTimer = null;
    $("#sum-stage").classList.add("hidden");
    btn.disabled = false;
    btn.textContent = "总结本视频";
    regenBtn.disabled = false;
    regenBtn.textContent = "重新总结";
    deepReadBtn.disabled = false;
    deepReadBtn.textContent = state.deepRead ? "重新精读" : "生成精读";
    renderSummaryState();
  }
}

async function startDeepRead() {
  if (!state.summary || state.busy.summary || state.busy.deepRead) return;
  if (!(await guardAction())) return;
  state.busy.deepRead = true;
  const deepReadAbort = new AbortController();
  const deepReadBtn = $("#btn-deep-read");
  const regenBtn = $("#btn-regen");
  const previousMode = state.summaryMode;

  deepReadBtn.disabled = true;
  deepReadBtn.textContent = "精读生成中…";
  regenBtn.disabled = true;
  document.querySelectorAll("[data-summary-mode]").forEach((button) => (button.disabled = true));
  $("#sum-stage-detail").textContent = "";
  $("#sum-stage-detail-wrap").classList.add("hidden");
  setSummaryProgress("正在准备精读材料…", "已有总结确定结构 · 完整字幕提供事实");
  startSummaryClock();
  $("#sum-md").classList.remove("hidden");
  $("#sum-md").innerHTML = "";

  try {
    const cues = await ensureCues();
    const text = await generateDeepRead({
      settings: state.settings,
      title: state.video.title,
      duration: Number(state.video.lengthSeconds) || 0,
      summary: summaryDocumentToMarkdown(state.summary),
      cues,
      signal: deepReadAbort.signal,
      onStage: (message, detail) => setSummaryProgress(message, detail),
      onDelta: (full) => {
        setSummaryProgress("正在撰写精读内容…");
        $("#sum-md").innerHTML = renderMarkdown(full);
        $("#sum-md").scrollTop = $("#sum-md").scrollHeight;
      },
    });
    state.deepRead = validateTimestamps(text, cues);
    state.summaryMode = "deep";
    await store.cacheSet(state.video.videoId, "deepRead", {
      data: text,
      title: state.video.title,
    });
    $("#sum-meta").textContent = `精读 · ${currentModelLabel()} · ${new Date().toLocaleTimeString(
      "zh-CN",
      { hour: "2-digit", minute: "2-digit" }
    )}`;
    renderSummaryState();
    toast("精读生成完成", "success");
  } catch (error) {
    state.summaryMode = state.deepRead ? previousMode : "summary";
    if (error && error.name === "AbortError") toast("已停止生成");
    else toast(error.message || "精读生成失败", "error");
    renderSummaryState();
  } finally {
    state.busy.deepRead = false;
    clearInterval(summaryProgressTimer);
    summaryProgressTimer = null;
    $("#sum-stage").classList.add("hidden");
    deepReadBtn.disabled = false;
    deepReadBtn.textContent = state.deepRead ? "重新精读" : "生成精读";
    regenBtn.disabled = false;
    regenBtn.textContent = "重新总结";
    document.querySelectorAll("[data-summary-mode]").forEach((button) => (button.disabled = false));
  }
}

let refiningPointId = null;

async function refinePoint(pointId, button) {
  if (!pointId || refiningPointId || !state.summary || state.busy.summary || state.busy.deepRead) return;
  if (!(await guardAction())) return;
  refiningPointId = pointId;
  const originalLabel = button.textContent;
  document.querySelectorAll("[data-summary-refine]").forEach((item) => (item.disabled = true));
  button.textContent = "优化中…";
  try {
    const cues = await ensureCues();
    state.summary = await refineSummaryPoint({
      settings: state.settings,
      title: state.video.title,
      document: state.summary,
      pointId,
      cues,
    });
    await store.cacheSet(state.video.videoId, "summary", {
      data: state.summary,
      title: state.video.title,
    });
    renderSummaryState();
    toast("这一条已优化", "success");
  } catch (error) {
    button.textContent = originalLabel;
    document.querySelectorAll("[data-summary-refine]").forEach((item) => (item.disabled = false));
    toast(error.message || "局部优化失败", "error");
  } finally {
    refiningPointId = null;
  }
}

/* ---------------- 对话页 ---------------- */

function chatBubble(role, html) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "assistant") bubble.classList.add("md"); // 复用 Markdown 样式（紧凑版）
  bubble.innerHTML = html;
  wrap.appendChild(bubble);
  $("#chat-list").appendChild(wrap);
  return bubble;
}

function renderChat(scroll = true) {
  const list = $("#chat-list");
  list.innerHTML = "";
  if (!state.chat.length) {
    list.innerHTML = `
      <div class="chat-empty" role="status">
        <span class="chat-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2 1.15-4.55A7.5 7.5 0 1 1 20 11.5Z"/>
            <path d="M8 10h8M8 13.5h5"/>
          </svg>
        </span>
        <p class="chat-empty-title">从视频里继续追问</p>
        <p class="chat-empty-copy">回答会参考字幕和当前播放位置，并附上可跳转的时间点</p>
      </div>`;
    return;
  }
  for (const m of state.chat) {
    chatBubble(m.role, renderMarkdown(m.content));
  }
  if (scroll) list.scrollTop = list.scrollHeight;
}

let chatAbort = null;

async function sendChat(question) {
  question = (question || "").trim();
  if (!question || state.busy.chat) return;
  if (!(await guardAction())) return;
  state.busy.chat = true;
  $("#btn-chat-send").classList.add("hidden");
  $("#btn-chat-stop").classList.remove("hidden");

  state.chat.push({ role: "user", content: question });
  if ($("#chat-list .chat-empty")) $("#chat-list").innerHTML = "";
  chatBubble("user", escapeHtmlText(question));
  const bubble = chatBubble("assistant", '<span class="typing"><i></i><i></i><i></i></span>');
  scrollChat(true);

  chatAbort = new AbortController();
  try {
    // 上下文：缓存/已生成的总结 + 当前播放位置附近的字幕
    let cues = state.cues;
    if (!cues && (state.video.tracks || []).length) {
      try {
        cues = await ensureCues();
        renderSubs($("#subs-search").value.trim());
      } catch (e) {}
    }
    const currentTime = await subs.getCurrentTime();
    const nearbyCues = cues ? subs.cuesNear(cues, currentTime) : [];
    const nearby = nearbyCues
      .map((c) => `[${subs.formatTime(c.start)}] ${c.text}`)
      .join("\n");
    const sys = prompts.chatSystemPrompt(state.video.title);
    const ctx = prompts.chatContextText({
      summary: state.summary ? summaryDocumentToMarkdown(state.summary) : "",
      nearbyText: nearby,
      currentTime,
      profileDigest: await memoryProfileDigest({ settings: state.settings }),
    });
    const history = state.chat.slice(-11, -1); // 不含刚 push 的这条
    const messages = [
      { role: "system", content: `${sys}\n\n${ctx}` },
      ...history,
      { role: "user", content: question },
    ];

    const reply = await api.chatStream({
      settings: state.settings,
      messages,
      signal: chatAbort.signal,
      onDelta: (full) => {
        bubble.innerHTML = renderMarkdown(full);
        scrollChat();
      },
    });
    state.chat.push({ role: "assistant", content: reply });
    await store.cacheSet(state.video.videoId, "chat", { data: state.chat, title: state.video.title });
    scrollChat(true);
  } catch (e) {
    if (e && e.name === "AbortError") {
      if (bubble.textContent.trim()) {
        state.chat.push({ role: "assistant", content: bubble.textContent });
      } else {
        bubble.closest(".msg").remove();
      }
      toast("已停止生成");
    } else {
      bubble.innerHTML = `<span class="err">${escapeHtmlText(e.message || "请求失败")}</span>`;
      toast(e.message || "请求失败", "error");
    }
  } finally {
    state.busy.chat = false;
    chatAbort = null;
    $("#btn-chat-send").classList.remove("hidden");
    $("#btn-chat-stop").classList.add("hidden");
    if (!state.chat.length) renderChat(false);
  }
}

function scrollChat(force = false) {
  const list = $("#chat-list");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  if (force || nearBottom) list.scrollTop = list.scrollHeight;
}

function escapeHtmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------------- 导图页 ---------------- */

function renderMapState() {
  const has = !!state.mindmap;
  $("#map-placeholder").classList.toggle("hidden", has);
  $("#map-wrap").classList.toggle("hidden", !has);
  $("#map-actions").classList.toggle("hidden", !has);
}

function renderMindmap(tree) {
  $("#map-placeholder").classList.add("hidden");
  $("#map-wrap").classList.remove("hidden");
  $("#map-actions").classList.remove("hidden");
  if (!mapRenderer) {
    mapRenderer = new MindMap($("#map-svg"), {
      onSeek: (t) => seekSeconds(t),
    });
  }
  mapRenderer.setData(tree);
}

let mapAbort = null;

async function startMindmap() {
  if (state.busy.map) return;
  if (!(await guardAction())) return;
  state.busy.map = true;
  mapAbort = new AbortController();
  $("#map-stage").classList.remove("hidden");

  try {
    const cues = await ensureCues();
    const text = await api.chatStream({
      settings: state.settings,
      messages: [
        { role: "system", content: prompts.mindmapSystemPrompt() },
        { role: "user", content: prompts.mindmapUserPrompt(subs.cuesToPromptText(cues), state.video.title) },
      ],
      signal: mapAbort.signal,
      onDelta: (full) => {
        $("#map-stage-text").textContent = `正在生成思维导图…（${full.length} 字）`;
      },
    });
    const tree = parseMindmapJson(text);
    state.mindmap = tree;
    await store.cacheSet(state.video.videoId, "mindmap", { data: tree, title: state.video.title });
    renderMindmap(tree);
    toast("思维导图已生成", "success");
  } catch (e) {
    if (e && e.name === "AbortError") {
      toast("已停止生成");
    } else {
      toast(e.message || "生成失败", "error");
      if (!state.mindmap) renderMapState();
    }
  } finally {
    state.busy.map = false;
    mapAbort = null;
    $("#map-stage").classList.add("hidden");
    $("#map-stage-text").textContent = "正在生成思维导图…";
  }
}

/* ---------------- 跳转（时间戳点击的统一入口） ---------------- */

async function seekSeconds(t) {
  try {
    await subs.seekTo(t);
  } catch (e) {
    toast(e.message || "跳转失败", "error");
  }
}

document.addEventListener("click", (e) => {
  const ts = e.target.closest("button.ts[data-t]");
  if (ts) seekSeconds(Number(ts.dataset.t));
});

/* ---------------- 设置页：多套模型配置 ---------------- */

function profileHost(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host;
  } catch (e) {
    return url;
  }
}

function profileSource(profile) {
  return profile.provider === "antigravity" ? "本机 Antigravity" : profileHost(profile.apiUrl);
}

function currentModelLabel() {
  return state.settings.profileName || state.settings.model || "";
}

// 渲染头部快速切换下拉 + 设置页配置列表
function renderProfiles() {
  const select = $("#model-select");
  const list = $("#profile-list");
  const activeId = state.settings.activeProfileId;
  const pencil =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
  const trash =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';

  select.innerHTML = state.profiles.length
    ? state.profiles
        .map(
          (p) =>
            `<option value="${p.id}"${p.id === activeId ? " selected" : ""}>${escapeHtmlText(
              p.name || p.model
            )}</option>`
        )
        .join("") + `<option value="__manage__">管理配置…</option>`
    : `<option value="" selected>未配置模型</option><option value="__manage__">去配置…</option>`;

  list.innerHTML = state.profiles.length
    ? state.profiles
        .map((p) => {
          const active = p.id === activeId;
          return `<div class="profile-row${active ? " active" : ""}" data-id="${p.id}" title="点击切换到此配置">
  <div class="profile-info">
    <span class="profile-name">${escapeHtmlText(p.name || p.model)}</span>
    <span class="profile-meta">${escapeHtmlText(p.model)} · ${escapeHtmlText(profileSource(p))}</span>
  </div>
  ${active ? '<span class="profile-badge">使用中</span>' : ""}
  <button class="icon-btn sm" type="button" data-act="edit" title="编辑">${pencil}</button>
  <button class="icon-btn sm" type="button" data-act="del" title="删除">${trash}</button>
</div>`;
        })
        .join("")
    : `<div class="profile-empty">还没有模型配置，点「＋ 新增」添加第一套</div>`;
}

// 换新对象而非原地改字段：进行中的生成请求继续持有旧配置对象，完成后新动作才用新模型
async function refreshSettingsState() {
  state.profiles = await store.getModelProfiles();
  state.settings = await store.getSettings();
  renderProfiles();
}

function openProfileEditor(profile) {
  $("#profile-form").classList.remove("hidden");
  $("#prof-id").value = profile ? profile.id : "";
  $("#prof-provider").value = profile && profile.provider === "antigravity" ? "antigravity" : "openai";
  $("#prof-name").value = profile ? profile.name : "";
  $("#prof-url").value = profile ? profile.apiUrl : "";
  $("#prof-key").value = profile ? profile.apiKey : "";
  $("#prof-model").value = profile ? profile.model : "";
  $("#prof-model-select").innerHTML = profile && profile.provider === "antigravity" && profile.model
    ? `<option value="${escapeHtmlText(profile.model)}" selected>${escapeHtmlText(profile.model)}</option>`
    : `<option value="">连接后选择 Gemini 模型</option>`;
  updateProviderEditor();
  $("#test-result").classList.add("hidden");
  $("#profile-form").scrollIntoView({ block: "nearest", behavior: "smooth" });
  $("#prof-name").focus();
}

function closeProfileEditor() {
  $("#profile-form").classList.add("hidden");
}

function setAntigravityStatus(kind, text) {
  $("#antigravity-dot").className = `antigravity-dot${kind ? ` ${kind}` : ""}`;
  $("#antigravity-status").textContent = text;
}

function updateProviderEditor() {
  const isAntigravity = $("#prof-provider").value === "antigravity";
  $("#openai-profile-fields").classList.toggle("hidden", isAntigravity);
  $("#antigravity-profile-fields").classList.toggle("hidden", !isAntigravity);
  $("#prof-model").classList.toggle("hidden", isAntigravity);
  $("#prof-model-select").classList.toggle("hidden", !isAntigravity);
  $("#btn-test").classList.toggle("hidden", isAntigravity);
  if (isAntigravity && !$("#prof-url").value.trim()) $("#prof-url").value = DEFAULT_CONNECTOR_URL;
}

async function connectAntigravity() {
  const button = $("#btn-antigravity-connect");
  const selected = $("#prof-model-select").value || $("#prof-model").value;
  button.disabled = true;
  button.textContent = "正在连接…";
  setAntigravityStatus("loading", "正在确认登录状态并读取模型…");
  try {
    const baseUrl = $("#prof-url").value.trim() || DEFAULT_CONNECTOR_URL;
    const [status, models] = await Promise.all([
      getAntigravityStatus(baseUrl),
      getAntigravityModels(baseUrl),
    ]);
    $("#prof-url").value = baseUrl;
    const fallbackModel = pickDefaultAntigravityModel(models);
    $("#prof-model-select").innerHTML = models
      .map((model) => {
        const active = model.id === selected || (!selected && model.id === fallbackModel);
        return `<option value="${escapeHtmlText(model.id)}"${active ? " selected" : ""}>${escapeHtmlText(model.name)}</option>`;
      })
      .join("");
    setAntigravityStatus("ok", `已连接 · agy ${status.cliVersion} · ${models.length} 个 Gemini 模型`);
    button.textContent = "刷新模型";
  } catch (error) {
    setAntigravityStatus("err", error.message || "连接失败");
    button.textContent = "重新连接";
  } finally {
    button.disabled = false;
  }
}

async function activateProfile(id) {
  if (!(await store.setActiveProfile(id))) return;
  await refreshSettingsState();
  const profile = state.profiles.find((p) => p.id === id);
  toast(`已切换到「${(profile && profile.name) || ""}」`, "success");
}

async function testConn() {
  const btn = $("#btn-test");
  const box = $("#test-result");
  const s = {
    provider: $("#prof-provider").value,
    apiUrl: $("#prof-url").value.trim(),
    apiKey: $("#prof-key").value.trim(),
    model: $("#prof-model").value.trim(),
  };
  box.classList.remove("hidden", "ok", "err");
  if (!s.apiUrl || !s.model) {
    box.classList.add("err");
    box.textContent = "请先填写 API 地址和模型";
    return;
  }
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "测试中…";
  box.textContent = "正在连接…";
  try {
    const r = await api.testConnection(s);
    box.classList.add("ok");
    box.textContent = `连接成功 · 延迟 ${r.latency}ms · 模型已响应`;
  } catch (e) {
    box.classList.add("err");
    box.textContent = e.message || "连接失败";
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) switchTab(btn.dataset.tab);
  });

  $("#btn-summarize").addEventListener("click", startSummary);
  $("#btn-regen").addEventListener("click", startSummary);
  $("#btn-deep-read").addEventListener("click", startDeepRead);
  $("#sum-md").addEventListener("click", (event) => {
    const evidenceButton = event.target.closest("[data-evidence-toggle]");
    if (evidenceButton) {
      const id = evidenceButton.dataset.evidenceToggle;
      const evidence = Array.from($("#sum-md").querySelectorAll("[data-evidence]")).find(
        (item) => item.dataset.evidence === id
      );
      if (!evidence) return;
      const willOpen = evidence.classList.contains("hidden");
      evidence.classList.toggle("hidden", !willOpen);
      evidenceButton.setAttribute("aria-expanded", String(willOpen));
      evidenceButton.querySelector("span:first-child").textContent = willOpen
        ? "收起字幕依据"
        : "查看字幕依据";
      return;
    }
    const selfTestButton = event.target.closest("[data-selftest-toggle]");
    if (selfTestButton) {
      const id = selfTestButton.dataset.selftestToggle;
      const answer = Array.from($("#sum-md").querySelectorAll("[data-selftest-answer]")).find(
        (item) => item.dataset.selftestAnswer === id
      );
      if (!answer) return;
      const willOpen = answer.classList.contains("hidden");
      answer.classList.toggle("hidden", !willOpen);
      selfTestButton.setAttribute("aria-expanded", String(willOpen));
      selfTestButton.querySelector("span").textContent = willOpen ? "收起答案" : "查看答案";
      return;
    }
    const refineButton = event.target.closest("[data-summary-refine]");
    if (refineButton && !refineButton.disabled) {
      void refinePoint(refineButton.dataset.summaryRefine, refineButton);
    }
  });
  $("#sum-mode-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-summary-mode]");
    if (!button || button.disabled) return;
    const mode = button.dataset.summaryMode;
    if (mode === "deep" && !state.deepRead) return;
    state.summaryMode = mode;
    renderSummaryState();
  });
  $("#sum-quality").addEventListener("click", (event) => {
    if (event.target.closest("[data-quality-retry]")) startSummary();
  });

  $("#history-list").addEventListener("click", async (e) => {
    const row = e.target.closest(".history-row");
    if (!row) return;
    if (e.target.closest("button[data-act='del']")) {
      await store.cacheRemoveVideo(row.dataset.id);
      toast("已删除该视频的记录");
      renderHistory();
      return;
    }
    openHistoryVideo(row);
  });
  let historySearchTimer = null;
  $("#history-search").addEventListener("input", () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(renderHistory, 150);
  });
  $("#btn-copy-summary").addEventListener("click", async () => {
    const content =
      state.summaryMode === "deep"
        ? state.deepRead
        : state.summary
          ? summaryDocumentToMarkdown(state.summary)
          : "";
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast(state.summaryMode === "deep" ? "精读已复制" : "总结已复制", "success");
    } catch (e) {
      toast("复制失败", "error");
    }
  });

  $("#btn-chat-send").addEventListener("click", () => {
    const ta = $("#chat-textarea");
    const q = ta.value;
    ta.value = "";
    autosizeTextarea();
    sendChat(q);
  });
  $("#btn-chat-stop").addEventListener("click", () => chatAbort && chatAbort.abort());
  $("#chat-quick").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) sendChat(chip.textContent.trim());
  });
  const ta = $("#chat-textarea");
  ta.addEventListener("input", autosizeTextarea);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("#btn-chat-send").click();
    }
  });
  function autosizeTextarea() {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  $("#track-select").addEventListener("change", async (e) => {
    state.trackIndex = Number(e.target.value);
    subtitleRequests.invalidate();
    state.cues = null;
    state.cuesVideoId = null;
    try {
      const res = await subtitleRequests.load(state.video?.videoId, state.trackIndex);
      state.cues = res.cues;
      state.cuesVideoId = res.videoId;
      setCuesSource(res);
      renderSubs($("#subs-search").value.trim());
      startFollow();
    } catch (err) {
      if (isStaleSubtitleError(err)) return;
      $("#subs-list").innerHTML = emptyRow(err.message);
    }
  });
  let searchTimer = null;
  $("#subs-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderSubs(e.target.value.trim()), 150);
  });
  $("#btn-follow").addEventListener("click", (e) => {
    state.follow = !state.follow;
    e.currentTarget.classList.toggle("active", state.follow);
    if (state.follow) startFollow();
    else stopFollow();
  });
  $("#subs-list").addEventListener("click", (e) => {
    const row = e.target.closest(".sub-row");
    if (!row || !state.cues) return;
    const cue = state.cues[Number(row.dataset.i)];
    if (cue) seekSeconds(cue.start);
  });

  $("#btn-gen-map").addEventListener("click", startMindmap);
  $("#btn-map-regen").addEventListener("click", startMindmap);
  $("#btn-map-expand").addEventListener("click", () => mapRenderer && mapRenderer.expandAll());
  $("#btn-map-collapse").addEventListener("click", () => mapRenderer && mapRenderer.collapseAll());
  $("#btn-map-fit").addEventListener("click", () => mapRenderer && mapRenderer.fit());

  $("#model-select").addEventListener("change", (e) => {
    const value = e.target.value;
    if (value === "__manage__") {
      switchTab("settings");
      renderProfiles(); // 把下拉选中项还原为当前配置
      return;
    }
    if (value && value !== state.settings.activeProfileId) activateProfile(value);
  });
  $("#btn-add-profile").addEventListener("click", () => openProfileEditor(null));
  $("#prof-provider").addEventListener("change", () => {
    updateProviderEditor();
    if ($("#prof-provider").value === "antigravity") connectAntigravity();
  });
  $("#btn-antigravity-connect").addEventListener("click", connectAntigravity);
  $("#btn-profile-cancel").addEventListener("click", closeProfileEditor);
  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const profile = {
      id: $("#prof-id").value,
      name: $("#prof-name").value.trim(),
      provider: $("#prof-provider").value,
      apiUrl: $("#prof-provider").value === "antigravity"
        ? ($("#prof-url").value.trim() || DEFAULT_CONNECTOR_URL)
        : $("#prof-url").value.trim(),
      apiKey: $("#prof-provider").value === "antigravity" ? "" : $("#prof-key").value.trim(),
      model: $("#prof-provider").value === "antigravity"
        ? $("#prof-model-select").value
        : $("#prof-model").value.trim(),
    };
    if (!profile.apiUrl || !profile.model) {
      toast("请填写 API 地址和模型", "error");
      return;
    }
    const isNew = !profile.id;
    if (!profile.name) profile.name = profile.model;
    try {
      await store.saveModelProfile(profile);
    } catch (err) {
      toast(err.message || "保存失败", "error");
      return;
    }
    await refreshSettingsState();
    closeProfileEditor();
    toast(isNew ? `已保存并切换到「${profile.name}」` : "配置已更新", "success");
  });
  $("#profile-list").addEventListener("click", (e) => {
    const row = e.target.closest(".profile-row");
    if (!row) return;
    const id = row.dataset.id;
    const act = e.target.closest("button[data-act]");
    if (act && act.dataset.act === "edit") {
      openProfileEditor(state.profiles.find((p) => p.id === id) || null);
      return;
    }
    if (act && act.dataset.act === "del") {
      const profile = state.profiles.find((p) => p.id === id);
      store.deleteModelProfile(id).then(async () => {
        if ($("#prof-id").value === id) closeProfileEditor(); // 被删的配置正在编辑中
        await refreshSettingsState();
        toast(`已删除「${(profile && profile.name) || ""}」`);
      });
      return;
    }
    if (!act && id !== state.settings.activeProfileId) activateProfile(id);
  });

  $("#btn-eye").addEventListener("click", () => {
    const input = $("#prof-key");
    input.type = input.type === "password" ? "text" : "password";
  });
  $("#btn-test").addEventListener("click", testConn);
  $("#btn-theme").addEventListener("click", async () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    state.settings = await store.saveSettings({ theme: next });
    applyTheme(next);
    $("#set-theme").value = next;
  });
  $("#set-theme").addEventListener("change", async (e) => {
    state.settings = await store.saveSettings({ theme: e.target.value });
    applyTheme(e.target.value);
  });
  $("#set-auto").addEventListener("change", async (e) => {
    state.settings = await store.saveSettings({ autoSummarize: e.target.checked });
  });
  $("#set-memory").addEventListener("change", async (e) => {
    state.settings = await store.saveSettings({ memoryEnabled: e.target.checked });
    $("#memory-panel").classList.toggle("disabled", !e.target.checked);
  });
  $("#btn-memory-clear").addEventListener("click", async () => {
    await clearMemory();
    await renderMemoryPanel();
    toast("已清空长期记忆");
  });
  $("#memory-panel").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-memory-del]");
    if (!del) return;
    await deleteMemoryEntry(del.dataset.memoryDel);
    await renderMemoryPanel();
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  await refreshSettingsState();
  applyTheme(state.settings.theme);
  $("#set-auto").checked = !!state.settings.autoSummarize;
  $("#set-theme").value = state.settings.theme || "auto";
  $("#set-memory").checked = state.settings.memoryEnabled !== false;
  $("#memory-panel").classList.toggle("disabled", state.settings.memoryEnabled === false);
  void renderMemoryPanel();
  bind();
  // 跟随系统时，系统切换深浅色要实时跟进；显式选择的主题不受影响
  observeSystemTheme(() => {
    if ((state.settings.theme || "auto") === "auto") applyTheme("auto");
  });
  refreshVideo();

  // YouTube SPA 切换视频 → 刷新状态（导航事件可能连续触发，做去抖）
  let navTimer = null;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "YT_VIDEO_CHANGED") {
      clearTimeout(navTimer);
      navTimer = setTimeout(refreshVideo, 400);
    }
  });
  chrome.tabs.onActivated.addListener(() => {
    clearTimeout(navTimer);
    navTimer = setTimeout(refreshVideo, 150);
  });
  // 地址栏直接打开另一个视频时，yt-navigate-finish 可能早于 content.js 注册监听。
  // 监听活动页 URL/加载完成，确保侧边栏不会继续显示上一个视频的状态。
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!tab.active || (!changeInfo.url && changeInfo.status !== "complete")) return;
    clearTimeout(navTimer);
    navTimer = setTimeout(refreshVideo, changeInfo.status === "complete" ? 150 : 400);
  });
}

init();
