// 历史库数据层测试：cacheList 按视频聚合，cacheRemoveVideo 只删该视频的全部条目。
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

const { cacheList, cacheRemoveVideo, cacheSummaries } = await import("../sidepanel/modules/store.js");

test("cacheList 把分散条目按视频聚合：取最新时间戳、合并类型、按时间倒序", async () => {
  installStorageMock({
    settings: { autoSummarize: true }, // 非 cache 键应被忽略
    "cache:v1:summary": { videoId: "v1", kind: "summary", ts: 200, title: "视频一", data: {} },
    "cache:v1:chat": { videoId: "v1", kind: "chat", ts: 300, title: "视频一", data: [] },
    "cache:BV1ab411c7mD?p=2:summary": {
      videoId: "BV1ab411c7mD?p=2",
      kind: "summary",
      ts: 100,
      title: "B站分P视频",
      data: {},
    },
  });

  const items = await cacheList();
  assert.equal(items.length, 2);
  // v1 的 chat 条目最新（ts 300），排第一
  assert.equal(items[0].videoId, "v1");
  assert.equal(items[0].title, "视频一");
  assert.equal(items[0].ts, 300);
  assert.deepEqual(items[0].kinds.sort(), ["chat", "summary"]);
  assert.equal(items[1].videoId, "BV1ab411c7mD?p=2");
  assert.deepEqual(items[1].kinds, ["summary"]);
});

test("title 缺失时回退为空字符串而不是 undefined", async () => {
  installStorageMock({
    "cache:v2:mindmap": { videoId: "v2", kind: "mindmap", ts: 5, data: {} },
  });
  const items = await cacheList();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "");
  assert.deepEqual(items[0].kinds, ["mindmap"]);
});

test("cacheRemoveVideo 只删该视频的条目，其他视频不受影响", async () => {
  const data = installStorageMock({
    "cache:v1:summary": { videoId: "v1", kind: "summary", ts: 1, title: "一" },
    "cache:v1:chat": { videoId: "v1", kind: "chat", ts: 2, title: "一" },
    "cache:v9:summary": { videoId: "v9", kind: "summary", ts: 3, title: "九" },
    "settings": { autoSummarize: false },
  });

  await cacheRemoveVideo("v1");
  assert.equal(data.has("cache:v1:summary"), false);
  assert.equal(data.has("cache:v1:chat"), false);
  assert.equal(data.has("cache:v9:summary"), true);
  assert.equal(data.has("settings"), true);

  const items = await cacheList();
  assert.equal(items.length, 1);
  assert.equal(items[0].videoId, "v9");
});

test("cacheSummaries 只返回总结条目的精简档案，供记忆检索使用", async () => {
  installStorageMock({
    "cache:v1:summary": {
      videoId: "v1",
      kind: "summary",
      ts: 200,
      title: "RAG 入门",
      data: {
        videoType: "tutorial",
        thesis: "检索增强生成流程",
        keyPoints: [{ text: "向量检索是第一步。" }, { text: "重排提升精度。" }],
        chapters: [{ title: "向量检索" }, { title: "生成" }],
      },
    },
    "cache:v1:chat": { videoId: "v1", kind: "chat", ts: 300, title: "RAG 入门", data: [] },
    "cache:v2:summary": { videoId: "v2", kind: "summary", ts: 100, title: "其他", data: null },
  });

  const summaries = await cacheSummaries();
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].videoId, "v1");
  assert.equal(summaries[0].videoType, "tutorial");
  assert.equal(summaries[0].thesis, "检索增强生成流程");
  assert.deepEqual(summaries[0].chapterTitles, ["向量检索", "生成"]);
  assert.deepEqual(summaries[0].keyPoints, ["向量检索是第一步。", "重排提升精度。"]);
  assert.equal(summaries[1].videoType, "general");
  assert.equal(summaries[1].thesis, "");
  assert.deepEqual(summaries[1].keyPoints, []);
});
