import assert from "node:assert/strict";
import test from "node:test";

import { renderSummaryDocument } from "../sidepanel/modules/summary-renderer.js";

test("结构化总结默认只展示结论，字幕证据按需展开", () => {
  const html = renderSummaryDocument({
    version: 2,
    videoType: "tutorial",
    thesis: "先理解问题，再执行步骤。",
    keyPoints: [
      {
        id: "point-1",
        timestamp: 12,
        text: "先确认真正的问题。",
        evidence: [{ start: 12, text: "字幕中的原始说法" }],
      },
    ],
    chapters: [{ id: "chapter-1", timestamp: 0, title: "开始", summary: "介绍问题。" }],
    extras: { title: "实践步骤", items: ["先记录问题"] },
  });

  assert.match(html, /summary-thesis/);
  assert.match(html, /教程/);
  assert.match(html, /data-evidence-toggle="point-1"/);
  assert.match(html, /class="summary-evidence hidden"/);
  assert.match(html, /data-summary-refine="point-1"/);
  assert.match(html, /data-t="12"/);
  assert.match(html, /实践步骤/);
});

test("渲染器会转义模型输出，避免把内容当成 HTML", () => {
  const html = renderSummaryDocument({
    version: 2,
    videoType: "general",
    thesis: "<img src=x onerror=alert(1)>",
    keyPoints: [],
    chapters: [],
    extras: null,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("自测问题默认隐藏答案，问题与时间戳都可交互", () => {
  const html = renderSummaryDocument({
    version: 3,
    videoType: "lecture",
    thesis: "理解梯度下降。",
    keyPoints: [],
    chapters: [],
    extras: null,
    selfTest: [
      { id: "quiz-1", timestamp: 42, question: "学习率的作用是什么？", answer: "控制每步更新的幅度。" },
    ],
  });

  assert.match(html, /自测问题/);
  assert.match(html, /data-selftest-toggle="quiz-1"/);
  assert.match(html, /data-selftest-answer="quiz-1"/);
  assert.match(html, /class="summary-selftest-answer hidden"/);
  assert.match(html, /学习率的作用是什么？/);
  assert.match(html, /控制每步更新的幅度。/);
  assert.match(html, /data-t="42"/);
});
