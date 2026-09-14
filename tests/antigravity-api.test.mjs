import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONNECTOR_URL,
  antigravityChatStream,
  getAntigravityModels,
  getAntigravityStatus,
  pickDefaultAntigravityModel,
} from "../sidepanel/modules/antigravity-api.js";
import { chatStream } from "../sidepanel/modules/api.js";

test("Antigravity 默认连接器避开 NewMax 使用的 17373 端口", () => {
  assert.equal(DEFAULT_CONNECTOR_URL, "http://127.0.0.1:17374");
});

test("连接器未运行时返回明确的启动提示", async () => {
  const offlineFetch = async () => {
    throw new TypeError("fetch failed");
  };

  await assert.rejects(
    getAntigravityStatus("http://127.0.0.1:17373", offlineFetch),
    /本地连接器未启动.*connector\/start\.command/
  );
});

test("插件只在最终完整文本到达后通知界面", async () => {
  const encoder = new TextEncoder();
  const firstEvent = encoder.encode('data: {"final":"第一段，第二段"}\n\n');
  const firstChineseByte = firstEvent.findIndex((byte) => byte > 0x7f);
  const streamFetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(firstEvent.slice(0, firstChineseByte + 1));
      controller.enqueue(firstEvent.slice(firstChineseByte + 1));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }));
  const updates = [];

  const result = await antigravityChatStream({
    settings: { apiUrl: "http://127.0.0.1:17373", model: "gemini-3.7-flash-low" },
    messages: [{ role: "user", content: "字幕" }],
    onDelta: (full) => updates.push(full),
    fetchImpl: streamFetch,
  });

  assert.equal(result, "第一段，第二段");
  assert.deepEqual(updates, ["第一段，第二段"]);
});

test("浏览器忽略损坏的流式增量，只展示 agy 最终完整文本", async () => {
  const streamFetch = async () => new Response([
    `data: ${JSON.stringify({ delta: "依靠���密自动化" })}\n\n`,
    `data: ${JSON.stringify({ final: "依靠严密自动化" })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""));
  const updates = [];

  const result = await antigravityChatStream({
    settings: { apiUrl: "http://127.0.0.1:17373", model: "gemini-3.7-flash-low" },
    messages: [{ role: "user", content: "字幕" }],
    onDelta: (full) => updates.push(full),
    fetchImpl: streamFetch,
  });

  assert.equal(result, "依靠严密自动化");
  assert.deepEqual(updates, ["依靠严密自动化"]);
});

test("插件可以读取连接器返回的 Gemini 模型列表", async () => {
  const modelFetch = async () => new Response(JSON.stringify({
    ok: true,
    models: [{ id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" }],
  }));

  assert.deepEqual(await getAntigravityModels("http://127.0.0.1:17373", modelFetch), [
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
  ]);
});

test("统一模型入口会把 Antigravity 配置交给本地连接器", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "http://127.0.0.1:17373/chat");
    return new Response('data: {"final":"Gemini 回答"}\n\ndata: [DONE]\n\n');
  };
  try {
    const answer = await chatStream({
      settings: {
        provider: "antigravity",
        apiUrl: "http://127.0.0.1:17373",
        model: "gemini-3.7-flash-low",
      },
      messages: [{ role: "user", content: "你好" }],
    });
    assert.equal(answer, "Gemini 回答");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("首次连接默认选择较快的最新 Flash Low，而不是列表首项 High", () => {
  const models = [
    { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
  ];
  assert.equal(pickDefaultAntigravityModel(models), "gemini-3.7-flash-low");
});

test("Antigravity 首次返回替换字符时自动重试并只接受干净结果", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const answer = calls === 1 ? "依靠���密自动化" : "依靠严密自动化";
    return new Response(`data: ${JSON.stringify({ final: answer })}\n\ndata: [DONE]\n\n`);
  };
  try {
    const answer = await chatStream({
      settings: {
        provider: "antigravity",
        apiUrl: "http://127.0.0.1:17373",
        model: "gemini-3.7-flash-low",
      },
      messages: [{ role: "user", content: "总结字幕" }],
    });
    assert.equal(answer, "依靠严密自动化");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
