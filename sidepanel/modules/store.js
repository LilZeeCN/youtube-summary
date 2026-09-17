// 设置与按视频缓存，全部存 chrome.storage.local（API Key 只保存在本地浏览器）
// 支持保存多套模型配置（名称 + API 地址 + Key + 模型）：激活的那套决定实际生效的 API 与模型。

import { DEFAULT_CONNECTOR_URL } from "./antigravity-api.js";

const SETTINGS_KEY = "settings";
const PROFILES_KEY = "modelProfiles";
const CACHE_PREFIX = "cache:";
const MAX_CACHE_ENTRIES = 200;
const LEGACY_CONNECTOR_URL = "http://127.0.0.1:17373";

const DEFAULT_SETTINGS = {
  provider: "openai",
  apiUrl: "",
  apiKey: "",
  model: "",
  autoSummarize: false, // 打开侧边栏且有字幕时自动开始总结
  theme: "auto", // 界面主题偏好：auto 跟随系统 / light / dark
  memoryEnabled: true, // 长期记忆：跨视频关联与用户画像（全部本地保存）
};

export { DEFAULT_SETTINGS };

function newProfileId() {
  return crypto.randomUUID();
}

function sanitizeProfile(profile) {
  const provider = profile.provider === "antigravity" ? "antigravity" : "openai";
  const rawApiUrl = String(profile.apiUrl || "").trim();
  const apiUrl = provider === "antigravity" && rawApiUrl.replace(/\/+$/, "") === LEGACY_CONNECTOR_URL
    ? DEFAULT_CONNECTOR_URL
    : rawApiUrl;
  return {
    id: String(profile.id || "") || newProfileId(),
    name: String(profile.name || profile.model || "").trim(),
    provider,
    apiUrl,
    apiKey: String(profile.apiKey || "").trim(),
    model: String(profile.model || "").trim(),
  };
}

// 读取全部模型配置；旧版只有单一配置时自动迁移成第一套，升级后无感
export async function getModelProfiles() {
  const obj = await chrome.storage.local.get([SETTINGS_KEY, PROFILES_KEY]);
  let profiles = Array.isArray(obj[PROFILES_KEY]) ? obj[PROFILES_KEY] : [];
  if (!profiles.length) {
    const legacy = { ...DEFAULT_SETTINGS, ...(obj[SETTINGS_KEY] || {}) };
    if (legacy.apiUrl && legacy.model) {
      const migrated = sanitizeProfile({
        name: legacy.model,
        apiUrl: legacy.apiUrl,
        apiKey: legacy.apiKey,
        model: legacy.model,
      });
      profiles = [migrated];
      await chrome.storage.local.set({
        [PROFILES_KEY]: profiles,
        [SETTINGS_KEY]: { ...(obj[SETTINGS_KEY] || {}), activeProfileId: migrated.id },
      });
    }
  }
  const cleanProfiles = profiles.map(sanitizeProfile);
  if (cleanProfiles.some((profile, index) => profile.apiUrl !== String(profiles[index]?.apiUrl || "").trim())) {
    await chrome.storage.local.set({ [PROFILES_KEY]: cleanProfiles });
  }
  return cleanProfiles;
}

async function getRawSettings() {
  const obj = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...(obj[SETTINGS_KEY] || {}) };
}

// 对外仍是扁平对象：全局开关 + 激活配置的 API 字段，调用方用法与旧版一致
export async function getSettings() {
  const [profiles, settings] = await Promise.all([getModelProfiles(), getRawSettings()]);
  const active = profiles.find((p) => p.id === settings.activeProfileId) || profiles[0] || null;
  if (active && active.id !== settings.activeProfileId) {
    // 指向的配置已不存在（如刚被删除），自愈到第一套
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, activeProfileId: active.id } });
  }
  return {
    ...DEFAULT_SETTINGS,
    autoSummarize: !!settings.autoSummarize,
    theme: settings.theme || "auto",
    memoryEnabled: settings.memoryEnabled !== false,
    provider: active ? active.provider : "openai",
    apiUrl: active ? active.apiUrl : "",
    apiKey: active ? active.apiKey : "",
    model: active ? active.model : "",
    profileName: active ? active.name : "",
    activeProfileId: active ? active.id : "",
  };
}

// patch 只应包含全局开关（如 autoSummarize）；API 字段由激活的配置管理
export async function saveSettings(patch) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...(await getRawSettings()), ...patch } });
  return getSettings();
}

// Ollama 等本地服务可以没有 Key，只要求 URL 与模型
export function isConfigured(s) {
  return !!(s && s.apiUrl && s.model);
}

// 新增的配置自动启用（配好即可直接用）；编辑已有的配置不改变当前激活
export async function saveModelProfile(profile) {
  const clean = sanitizeProfile(profile);
  if (!clean.apiUrl || !clean.model) throw new Error("配置缺少 API 地址或模型");
  const profiles = await getModelProfiles();
  const index = profiles.findIndex((p) => p.id === clean.id);
  if (index >= 0) {
    profiles[index] = clean;
  } else {
    profiles.push(clean);
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...(await getRawSettings()), activeProfileId: clean.id },
    });
  }
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  return clean;
}

export async function deleteModelProfile(id) {
  const profiles = await getModelProfiles();
  const remaining = profiles.filter((p) => p.id !== id);
  if (remaining.length === profiles.length) return remaining;
  const settings = await getRawSettings();
  const patch = { [PROFILES_KEY]: remaining };
  if (settings.activeProfileId === id) {
    patch[SETTINGS_KEY] = { ...settings, activeProfileId: remaining.length ? remaining[0].id : "" };
  }
  await chrome.storage.local.set(patch);
  return remaining;
}

export async function setActiveProfile(id) {
  const profiles = await getModelProfiles();
  if (!profiles.some((p) => p.id === id)) return false;
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...(await getRawSettings()), activeProfileId: id } });
  return true;
}

const cacheKey = (videoId, kind) => `${CACHE_PREFIX}${videoId}:${kind}`;

function containsReplacementCharacter(value) {
  if (typeof value === "string") return value.includes("\uFFFD");
  if (Array.isArray(value)) return value.some(containsReplacementCharacter);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsReplacementCharacter);
  }
  return false;
}

export async function cacheGet(videoId, kind) {
  if (!videoId) return null;
  const key = cacheKey(videoId, kind);
  const obj = await chrome.storage.local.get(key);
  const entry = obj[key] || null;
  if (containsReplacementCharacter(entry)) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry;
}

export async function cacheSet(videoId, kind, entry) {
  if (!videoId) return;
  const key = cacheKey(videoId, kind);
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (cacheKeys.length >= MAX_CACHE_ENTRIES && !cacheKeys.includes(key)) {
    const oldest = cacheKeys.sort(
      (a, b) => (all[a].ts || 0) - (all[b].ts || 0)
    ).slice(0, cacheKeys.length - MAX_CACHE_ENTRIES + 1);
    await chrome.storage.local.remove(oldest);
  }
  await chrome.storage.local.set({
    [key]: { videoId, kind, ts: Date.now(), ...entry },
  });
}

export async function cacheRemove(videoId, kind) {
  if (!videoId) return;
  await chrome.storage.local.remove(cacheKey(videoId, kind));
}

// 历史库：把分散的 cache: 条目按视频聚合，最近更新的排前面
export async function cacheList() {
  const all = await chrome.storage.local.get(null);
  const videos = new Map();
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(CACHE_PREFIX) || !entry || !entry.videoId) continue;
    const item = videos.get(entry.videoId) || {
      videoId: entry.videoId,
      title: "",
      ts: 0,
      kinds: new Set(),
    };
    item.title = item.title || String(entry.title || "");
    item.ts = Math.max(item.ts, Number(entry.ts) || 0);
    item.kinds.add(entry.kind);
    videos.set(entry.videoId, item);
  }
  return [...videos.values()]
    .map((item) => ({ ...item, kinds: [...item.kinds] }))
    .sort((a, b) => b.ts - a.ts);
}

// 删除一个视频的全部缓存（历史库的单条删除）
export async function cacheRemoveVideo(videoId) {
  if (!videoId) return;
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (k) => k.startsWith(CACHE_PREFIX) && all[k] && all[k].videoId === videoId
  );
  await chrome.storage.local.remove(keys);
}

// 情景记忆视图：全部已总结视频的精简档案，供长期记忆做跨视频检索
export async function cacheSummaries() {
  const all = await chrome.storage.local.get(null);
  const out = [];
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(CACHE_PREFIX) || !entry || entry.kind !== "summary" || !entry.videoId) continue;
    const data = entry.data && typeof entry.data === "object" ? entry.data : {};
    out.push({
      videoId: entry.videoId,
      title: String(entry.title || ""),
      ts: Number(entry.ts) || 0,
      videoType: data.videoType || "general",
      thesis: String(data.thesis || ""),
      chapterTitles: Array.isArray(data.chapters)
        ? data.chapters.map((chapter) => chapter && chapter.title).filter(Boolean)
        : [],
      keyPoints: Array.isArray(data.keyPoints)
        ? data.keyPoints.map((point) => point && point.text).filter(Boolean).slice(0, 8)
        : [],
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
