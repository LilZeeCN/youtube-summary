// store.js 多模型配置逻辑测试：内存版 chrome.storage.local，只实现用到的 Promise 形式。
import { test } from "node:test";
import assert from "node:assert/strict";

function installStorageMock(initial = {}) {
  const data = new Map(Object.entries(initial));
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (keys === null || keys === undefined) return Object.fromEntries(data);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (data.has(k)) out[k] = data.get(k);
          return out;
        },
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) data.set(k, v);
        },
        remove: async (keys) => {
          for (const k of [].concat(keys)) data.delete(k);
        },
      },
    },
  };
  return data;
}

const {
  getSettings,
  getModelProfiles,
  saveModelProfile,
  saveSettings,
  deleteModelProfile,
  setActiveProfile,
  isConfigured,
  cacheGet,
} = await import("../sidepanel/modules/store.js");

test("旧版单一配置自动迁移为第一个模型配置，字段原样保留", async () => {
  installStorageMock({
    settings: {
      apiUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-1",
      model: "deepseek-chat",
      autoSummarize: true,
    },
  });
  const profiles = await getModelProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].apiUrl, "https://api.deepseek.com/v1");
  assert.equal(profiles[0].apiKey, "sk-1");
  assert.equal(profiles[0].model, "deepseek-chat");

  const settings = await getSettings();
  assert.equal(settings.apiUrl, "https://api.deepseek.com/v1");
  assert.equal(settings.model, "deepseek-chat");
  assert.equal(settings.apiKey, "sk-1");
  assert.equal(settings.autoSummarize, true);
  assert.equal(settings.activeProfileId, profiles[0].id);
  assert.equal(isConfigured(settings), true);
});

test("新增配置自动启用，编辑与删除不破坏激活状态", async () => {
  installStorageMock({});
  const a = await saveModelProfile({
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-a",
    model: "deepseek-chat",
  });
  const b = await saveModelProfile({
    name: "本地",
    apiUrl: "http://localhost:11434/v1",
    model: "qwen2.5",
  });
  // 新增的第二个配置自动启用
  assert.equal((await getSettings()).activeProfileId, b.id);

  // 切回 A 后编辑未激活的 B：激活不变
  assert.equal(await setActiveProfile(a.id), true);
  await saveModelProfile({ ...b, name: "本地 Qwen" });
  let settings = await getSettings();
  assert.equal(settings.activeProfileId, a.id);
  assert.equal(settings.model, "deepseek-chat");

  // 删除正在激活的 A：自动回退到剩下的第一套
  await deleteModelProfile(a.id);
  settings = await getSettings();
  assert.equal(settings.activeProfileId, b.id);
  assert.equal(settings.model, "qwen2.5");
  assert.equal(settings.profileName, "本地 Qwen");

  // 删光后回到未配置状态
  await deleteModelProfile(b.id);
  settings = await getSettings();
  assert.equal(isConfigured(settings), false);
  assert.equal(settings.activeProfileId, "");
});

test("saveSettings 只影响全局开关，不覆盖激活配置的 API 字段", async () => {
  installStorageMock({});
  const a = await saveModelProfile({
    name: "A",
    apiUrl: "https://a.example/v1",
    apiKey: "sk-a",
    model: "ma",
  });
  const settings = await saveSettings({ autoSummarize: true });
  assert.equal(settings.autoSummarize, true);
  assert.equal(settings.model, "ma"); // API 字段仍来自激活配置
  assert.equal(settings.activeProfileId, a.id);
});

test("Antigravity 配置保存提供商类型、连接器地址和所选模型", async () => {
  installStorageMock({});
  const profile = await saveModelProfile({
    name: "Antigravity · Gemini",
    provider: "antigravity",
    apiUrl: "http://127.0.0.1:17374",
    model: "gemini-3.7-flash-low",
  });
  const settings = await getSettings();

  assert.equal(profile.provider, "antigravity");
  assert.equal(settings.provider, "antigravity");
  assert.equal(settings.apiUrl, "http://127.0.0.1:17374");
  assert.equal(settings.model, "gemini-3.7-flash-low");
  assert.equal(isConfigured(settings), true);
});

test("旧 Antigravity 端口配置自动迁移到 17374 并写回存储", async () => {
  const data = installStorageMock({
    modelProfiles: [{
      id: "antigravity-old-port",
      name: "Antigravity",
      provider: "antigravity",
      apiUrl: "http://127.0.0.1:17373",
      apiKey: "",
      model: "gemini-3.7-flash-low",
    }],
  });

  const profiles = await getModelProfiles();

  assert.equal(profiles[0].apiUrl, "http://127.0.0.1:17374");
  assert.equal(data.get("modelProfiles")[0].apiUrl, "http://127.0.0.1:17374");
});

test("读取缓存时自动删除包含替换字符的旧生成结果", async () => {
  const key = "cache:video-1:summary";
  const data = installStorageMock({
    [key]: {
      videoId: "video-1",
      kind: "summary",
      data: { text: "依靠���密自动化" },
    },
  });

  assert.equal(await cacheGet("video-1", "summary"), null);
  assert.equal(data.has(key), false);
});
