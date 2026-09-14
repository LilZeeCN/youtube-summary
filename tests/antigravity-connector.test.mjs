import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAntigravityServer } from "../connector/server.mjs";

const fakeCli = fileURLToPath(new URL("./fixtures/fake-agy.mjs", import.meta.url));

async function withServer(run) {
  const server = createAntigravityServer({ cliPath: fakeCli });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("本地连接器能确认 Antigravity CLI 已就绪且不返回登录凭据", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "chrome-extension://abcdefghijklmnop" },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      service: "antigravity-connector",
      cliVersion: "1.1.13",
    });
    assert.equal(JSON.stringify(body).includes("token"), false);
  });
});

test("模型接口只返回可选择的 Gemini 模型并保留展示名称", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Origin: "chrome-extension://abcdefghijklmnop" },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.models, [
      { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
      { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)" },
    ]);
  });
});

test("生成接口只把 Antigravity 的最终完整回答发送给浏览器", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnop",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.7-flash-low",
        messages: [
          { role: "system", content: "请准确总结" },
          { role: "user", content: "字幕内容" },
        ],
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /\{"delta":/);
    assert.match(text, /data: \{"final":"第一段，第二段"\}/);
    assert.match(text, /data: \[DONE\]/);
  });
});

test("地区限制时返回真实原因，不误导用户重新登录", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnop",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.7-flash-low",
        messages: [{ role: "user", content: "[地区限制测试]" }],
      }),
    });
    const text = await response.text();

    assert.match(text, /当前网络所在地区不支持 API 调用/);
    assert.doesNotMatch(text, /检查登录状态/);
  });
});

test("生成前会替换字幕中的损坏字符，不把乱码继续传给模型", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnop",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.7-flash-low",
        messages: [{ role: "user", content: "[输入清理测试] 字幕���内容" }],
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /输入已清理/);
    assert.doesNotMatch(text, /输入仍损坏/);
  });
});

test("连接器丢弃损坏的 agy 流式增量，只返回最终完整文本", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnop",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.7-flash-low",
        messages: [{ role: "user", content: "[最终文本校验测试]" }],
      }),
    });
    const text = await response.text();

    assert.doesNotMatch(text, /\{"delta":/);
    assert.match(text, /\{"final":"依靠严密自动化"\}/);
  });
});
