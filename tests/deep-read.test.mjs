import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

const { generateDeepRead } = await import(
  new URL("../sidepanel/modules/deep-read.js", import.meta.url)
);

test("deep reading uses both the existing summary and the transcript", async (t) => {
  let capturedBody = null;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      const answer = `# 深度学习笔记：Pi Agent
## 先建立整体认识
解释它解决的问题。
## 章节精读
### [00:08] 工具调用机制
说明消息进入循环后如何调用工具并返回结果。
## 易错点与边界
不要把循环次数当成任务完成条件。`;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const stages = [];
  const result = await generateDeepRead({
    settings: {
      apiUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: "",
      model: "test-model",
    },
    title: "Pi Agent 入门",
    duration: 600,
    summary: "## 一句话总结\n视频介绍 Pi Agent 的工具调用循环。",
    cues: [
      { start: 8, text: "PAGENT会进入loop判断是否需要调用tool" },
      { start: 30, text: "工具结果会重新放回上下文继续推理" },
    ],
    onStage: (message) => stages.push(message),
  });

  const userPrompt = capturedBody.messages.find((message) => message.role === "user").content;
  assert.match(userPrompt, /已有总结/);
  assert.match(userPrompt, /工具调用循环/);
  assert.match(userPrompt, /完整字幕/);
  assert.match(userPrompt, /PAGENT会进入loop/);
  assert.match(result, /## 章节精读/);
  assert.match(stages.join("\n"), /精读|细节/);
});
