// 侧边栏侧的字幕工具：与内容脚本通信、时间格式化、给 AI 的文本拼装

export const NO_CONTENT_SCRIPT = "未连接到页面，请刷新视频页签后重试";

export async function getActiveTab() {
  const requestedId = Number(
    new URLSearchParams(globalThis.location?.search || "").get("tabId")
  );
  if (Number.isInteger(requestedId) && requestedId > 0) {
    try {
      return await chrome.tabs.get(requestedId);
    } catch (e) {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

const isSupportedSite = (url) =>
  /^https:\/\/www\.(youtube|bilibili)\.com\//.test(url || "");

async function injectContentScripts(tab) {
  const bridge = tab.url.includes("bilibili.com")
    ? "content/bili-bridge.js"
    : "content/page-bridge.js";
  if (!tab.url.includes("bilibili.com")) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/youtube-caption-cache.js"],
      world: "MAIN",
    });
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [bridge],
    world: "MAIN",
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/youtube-caption-cache.js", "content/bili-provenance.js", "content/content.js"],
    world: "ISOLATED",
  });
}

export async function sendToTab(type, payload = {}) {
  const tab = await getActiveTab();
  if (!tab || !isSupportedSite(tab.url)) {
    throw new Error("请先切到一个 YouTube / B站 视频页签");
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, payload });
  } catch (e) {
    try {
      await injectContentScripts(tab);
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch {
      throw new Error(NO_CONTENT_SCRIPT);
    }
  }
}

export async function getVideoInfo() {
  const res = await sendToTab("GET_INFO");
  if (!res || !res.ok) throw new Error((res && res.error) || "读取视频信息失败");
  return res.info;
}

export async function loadSubtitles(trackIndex, videoId) {
  const res = await sendToTab("GET_SUBTITLES", { trackIndex, videoId });
  if (!res || !res.ok) throw new Error((res && res.error) || "字幕获取失败");
  return res; // { cues, track }
}

export async function getCurrentTime() {
  try {
    const res = await sendToTab("GET_TIME");
    if (res && res.ok) return res.time || 0;
  } catch (e) {}
  return 0;
}

export async function seekTo(seconds) {
  return sendToTab("SEEK", { time: seconds });
}

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function parseTimestamp(ts) {
  const parts = String(ts).split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// 给 AI 的字幕文本：每行 [mm:ss] 一句，时间戳是它引用与跳转的依据
export function cuesToPromptText(cues) {
  return cues.map((c) => `[${formatTime(c.start)}] ${c.text}`).join("\n");
}

// 取当前播放位置附近的字幕（追问时注入上下文用）
export function cuesNear(cues, t, windowSec = 240) {
  return cues.filter((c) => c.start >= t - windowSec / 2 && c.start <= t + windowSec / 2);
}
