// 长期记忆层测试：本地检索、规范化限额、睡眠期整合、管理操作。
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
  normalizeMemory,
  tokenize,
  rankRelatedVideos,
  findRelevantTopics,
  buildMemoryContext,
  consolidateMemory,
  loadMemory,
  clearMemory,
  deleteMemoryEntry,
  retrieveChatVideos,
} = await import("../sidepanel/modules/memory.js");

test("tokenize 产出拉丁词与中文二元组", () => {
  const tokens = tokenize("RAG 检索增强生成");
  assert.ok(tokens.includes("rag"));
  assert.ok(tokens.includes("检索"));
  assert.ok(tokens.includes("增强"));
  assert.deepEqual(tokenize("好"), ["好"]);
});

test("rankRelatedVideos 把相关视频排在前面，排除自身与低分项", () => {
  const videos = [
    {
      videoId: "rag-intro",
      title: "RAG 检索增强生成入门",
      thesis: "讲解检索增强生成的完整流程",
      chapterTitles: ["向量检索", "生成"],
    },
    {
      videoId: "cooking",
      title: "十分钟做一碗红烧牛肉面",
      thesis: "家常面条做法",
      chapterTitles: ["煮面"],
    },
    {
      videoId: "self",
      title: "RAG 检索增强生成入门（重新上传）",
      thesis: "讲解检索增强生成的完整流程",
      chapterTitles: [],
    },
  ];
  const ranked = rankRelatedVideos("RAG 检索增强生成实践", videos, { excludeVideoId: "self" });
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].videoId, "rag-intro");
  assert.ok(!ranked.some((item) => item.videoId === "cooking"));
  assert.ok(!ranked.some((item) => item.videoId === "self"));
});

test("normalizeMemory 去重事实、合并同名主题并保持 id 稳定", () => {
  const once = normalizeMemory({
    facts: ["用户是前端工程师", "用户是前端工程师。", "  "],
    topics: [
      { name: "RAG", note: "了解基本流程", videoIds: ["v1"] },
      { name: "rag ", note: "了解检索增强生成的完整流程与调参", videoIds: ["v2"] },
    ],
  });
  assert.equal(once.facts.length, 1);
  assert.equal(once.topics.length, 1);
  assert.equal(once.topics[0].name, "RAG");
  assert.deepEqual(once.topics[0].videoIds.sort(), ["v1", "v2"]);
  assert.match(once.topics[0].note, /完整流程/);

  const again = normalizeMemory(once);
  assert.equal(again.facts[0].id, once.facts[0].id);
  assert.equal(again.topics[0].id, once.topics[0].id);
});

test("buildMemoryContext 关闭记忆返回 null，开启后带画像与相关视频", async () => {
  installStorageMock({
    memory: {
      version: 1,
      facts: [{ id: "f1", text: "用户关注 AI 工程" }],
      topics: [{ id: "t1", name: "RAG", note: "了解检索流程", videoIds: ["rag1"] }],
    },
    "cache:rag1:summary": {
      videoId: "rag1",
      kind: "summary",
      ts: 100,
      title: "RAG 入门",
      data: { videoType: "tutorial", thesis: "检索增强生成流程", chapters: [{ title: "向量检索" }] },
    },
  });

  const disabled = await buildMemoryContext({
    settings: { memoryEnabled: false },
    videoId: "new1",
    title: "RAG 进阶",
  });
  assert.equal(disabled, null);

  const context = await buildMemoryContext({
    settings: { memoryEnabled: true },
    videoId: "new1",
    title: "RAG 进阶：检索增强生成的调优",
    description: "",
    transcriptSample: "今天讲检索增强生成的调优方法",
  });
  assert.ok(context.facts.includes("用户关注 AI 工程"));
  assert.ok(context.relatedVideos.some((video) => video.videoId === "rag1"));
  assert.ok(context.topics.some((topic) => topic.name === "RAG"));
});

test("consolidateMemory 用一次调用重写记忆并落盘", async () => {
  installStorageMock({
    memory: { version: 1, facts: [{ id: "f1", text: "旧事实" }], topics: [] },
  });
  const calls = [];
  const merged = await consolidateMemory({
    settings: { memoryEnabled: true },
    videoId: "v9",
    title: "RAG 调优",
    summaryDocument: {
      videoType: "tutorial",
      thesis: "调优检索质量",
      keyPoints: [{ text: "切分粒度影响召回。" }],
      chapters: [{ title: "切分策略" }],
      extras: null,
    },
    chat: async (request) => {
      calls.push(request);
      return JSON.stringify({
        facts: ["用户在持续学习 RAG 调优", "旧事实"],
        topics: [{ name: "RAG", note: "已了解流程与切分策略", videoIds: ["v9"] }],
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[1].content, /v9/);
  assert.match(calls[0].messages[1].content, /RAG 调优/);
  assert.ok(merged.facts.some((fact) => fact.text === "用户在持续学习 RAG 调优"));

  const stored = await loadMemory();
  assert.equal(stored.facts.length, 2);
  assert.equal(stored.topics[0].videoIds[0], "v9");
});

test("consolidateMemory 遇到非法输出时保持记忆原样", async () => {
  installStorageMock({
    memory: { version: 1, facts: [{ id: "f1", text: "旧事实" }], topics: [] },
  });
  const result = await consolidateMemory({
    settings: {},
    videoId: "v1",
    title: "任意",
    summaryDocument: {},
    chat: async () => "这不是 JSON",
  });
  assert.equal(result, null);
  const stored = await loadMemory();
  assert.equal(stored.facts.length, 1);
  assert.equal(stored.facts[0].text, "旧事实");
});

test("可以删除单条记忆或全部清空", async () => {
  installStorageMock({
    memory: {
      version: 1,
      facts: [{ id: "whatever", text: "事实A" }, { id: "x", text: "事实B" }],
      topics: [{ id: "t", name: "RAG", note: "n", videoIds: [] }],
    },
  });
  // id 由内容哈希生成：先读出实际 id 再删
  const loaded = await loadMemory();
  const idA = loaded.facts.find((fact) => fact.text === "事实A").id;
  const topicId = loaded.topics[0].id;
  await deleteMemoryEntry(idA);
  let memory = await loadMemory();
  assert.equal(memory.facts.length, 1);
  assert.equal(memory.facts[0].text, "事实B");
  assert.equal(memory.topics.length, 1);

  await deleteMemoryEntry(topicId);
  memory = await loadMemory();
  assert.equal(memory.topics.length, 0);

  const cleared = await clearMemory();
  assert.deepEqual(cleared.facts, []);
});

test("retrieveChatVideos 按问题检索相关视频并携带要点", async () => {
  installStorageMock({
    "cache:rag1:summary": {
      videoId: "rag1",
      kind: "summary",
      ts: 100,
      title: "RAG 入门",
      data: {
        videoType: "tutorial",
        thesis: "检索增强生成流程",
        keyPoints: [{ text: "向量检索是第一步。" }, { text: "重排提升精度。" }],
        chapters: [{ title: "向量检索" }],
      },
    },
    "cache:cook:summary": {
      videoId: "cook",
      kind: "summary",
      ts: 200,
      title: "红烧牛肉面",
      data: { videoType: "general", thesis: "面条做法", keyPoints: [] },
    },
  });

  const disabled = await retrieveChatVideos({
    settings: { memoryEnabled: false },
    query: "RAG 的检索怎么做",
  });
  assert.deepEqual(disabled, []);

  const videos = await retrieveChatVideos({
    settings: { memoryEnabled: true },
    query: "RAG 的检索怎么做",
    excludeVideoId: "self",
    limit: 2,
  });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].videoId, "rag1");
  assert.equal(videos[0].title, "RAG 入门");
  assert.deepEqual(videos[0].keyPoints, ["向量检索是第一步。", "重排提升精度。"]);
});
