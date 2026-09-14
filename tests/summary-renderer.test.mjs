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

test("关联视频渲染为可打开的链接并转义内容", () => {
  const html = renderSummaryDocument({
    version: 4,
    videoType: "tutorial",
    thesis: "向量检索实践。",
    keyPoints: [],
    chapters: [],
    extras: null,
    connections: [
      {
        videoId: "rag1",
        videoTitle: "RAG 入门<script>",
        relation: "延伸",
        text: "把上次的检索策略推进到混合检索。",
      },
      {
        videoId: "BV1ab411c7mD?p=2",
        videoTitle: "B站视频",
        relation: "对比",
        text: "两个视频对切分粒度结论相反。",
      },
    ],
  });

  assert.match(html, /关联视频/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=rag1"/);
  assert.match(html, /href="https:\/\/www\.bilibili\.com\/video\/BV1ab411c7mD\?p=2"/);
  assert.match(html, /延伸/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /B站/);
});
