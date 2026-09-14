import assert from "node:assert/strict";
import test from "node:test";

import { generateSummary, refineSummaryPoint } from "../sidepanel/modules/summarize.js";

test("短视频生成接口直接返回可渲染的 SummaryDocument", async () => {
  const calls = [];
  const document = await generateSummary({
    settings: { model: "test" },
    title: "从零开始搭建工作流教程",
    duration: 80,
    description: "安装并完成第一个自动化流程",
    cues: [
      { start: 0, text: "今天从零开始搭建一个工作流。" },
      { start: 15, text: "先创建项目，再连接输入。" },
    ],
    chat: async (request) => {
      calls.push(request);
      return JSON.stringify({
        videoType: "tutorial",
        thesis: "视频演示了搭建工作流的基本过程。",
        keyPoints: [{ timestamp: "00:15", text: "先创建项目并连接输入。" }],
        chapters: [{ timestamp: "00:00", title: "开始搭建", summary: "从项目开始。" }],
        extras: { title: "实践步骤", items: ["创建项目", "连接输入"] },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /JSON/);
  assert.equal(document.version, 2);
  assert.equal(document.videoType, "tutorial");
  assert.ok(document.keyPoints[0].evidence.some((item) => item.start === 15));
});

test("局部优化只替换指定要点并保留原字幕证据", async () => {
  const original = {
    version: 2,
    videoType: "tutorial",
    thesis: "演示工作流。",
    keyPoints: [
      {
        id: "point-1",
        timestamp: 15,
        text: "旧的表述。",
        evidence: [{ start: 15, text: "先创建项目，再连接输入。" }],
      },
      { id: "point-2", timestamp: 30, text: "保持不变。", evidence: [] },
    ],
    chapters: [],
    extras: null,
  };

  const updated = await refineSummaryPoint({
    settings: { model: "test" },
    title: "工作流教程",
    document: original,
    pointId: "point-1",
    cues: [],
    chat: async () => '{"text":"先创建项目，再把输入连接到工作流。"}',
  });

  assert.equal(updated.keyPoints[0].text, "先创建项目，再把输入连接到工作流。");
  assert.deepEqual(updated.keyPoints[0].evidence, original.keyPoints[0].evidence);
  assert.equal(updated.keyPoints[1].text, "保持不变。");
});
