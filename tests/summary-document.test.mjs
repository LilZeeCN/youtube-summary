import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSummaryDocument,
  parseSummaryResponse,
  summaryDocumentToMarkdown,
} from "../sidepanel/modules/summary-document.js";

const cues = [
  { start: 0, text: "今天介绍怎样把一段长视频整理成可靠的笔记。" },
  { start: 12, text: "第一步是保留每个结论对应的字幕出处。" },
  { start: 18, text: "这样读者可以快速回到原视频核对。" },
  { start: 61, text: "最后再按照内容类型补充行动项。" },
];

test("模型 JSON 会被规范化为带本地字幕证据的 SummaryDocument", () => {
  const raw = `\`\`\`json
  {
    "videoType": "tutorial",
    "thesis": "可靠的视频总结需要让结论可以回到原字幕核对。",
    "keyPoints": [
      { "timestamp": "00:13", "text": "每个结论都应保留字幕出处。" }
    ],
    "chapters": [
      { "timestamp": "01:00", "title": "形成行动项", "summary": "按视频类型整理下一步。" }
    ],
    "extras": { "title": "可执行清单", "items": ["核对关键结论", "整理行动项"] }
  }
  \`\`\``;

  const document = parseSummaryResponse(raw, { cues });

  assert.equal(document.version, 4);
  assert.equal(document.videoType, "tutorial");
  assert.equal(document.keyPoints[0].id, "point-1");
  assert.equal(document.keyPoints[0].timestamp, 12);
  assert.deepEqual(document.keyPoints[0].evidence, [
    { start: 12, text: "第一步是保留每个结论对应的字幕出处。" },
    { start: 18, text: "这样读者可以快速回到原视频核对。" },
  ]);
  assert.equal(document.chapters[0].timestamp, 61);
  assert.deepEqual(document.extras.items, ["核对关键结论", "整理行动项"]);
});

test("旧 Markdown 缓存会迁移为结构化文档并保持可复制内容", () => {
  const legacy = `## 一句话总结
这个视频解释了如何制作可核对的视频总结。

## 关键要点
- [00:12] 为结论保留字幕出处
- [01:01] 按内容类型整理行动项

## 章节摘要
### [00:00] 为什么需要证据
只有能回到原视频的结论才方便复核。

### [01:01] 下一步
把结论转成清晰的行动项。`;

  const document = normalizeSummaryDocument(legacy, { cues });

  assert.equal(document.version, 4);
  assert.equal(document.thesis, "这个视频解释了如何制作可核对的视频总结。");
  assert.equal(document.keyPoints.length, 2);
  assert.equal(document.keyPoints[0].timestamp, 12);
  assert.equal(document.chapters.length, 2);
  assert.match(summaryDocumentToMarkdown(document), /## 一句话总结/);
  assert.match(summaryDocumentToMarkdown(document), /- \[0:12\] 为结论保留字幕出处/);
  assert.match(summaryDocumentToMarkdown(document), /### \[1:01\] 下一步/);
});

test("已经是新版缓存时只做清洗，不丢失已有证据", () => {
  const cached = {
    version: 2,
    videoType: "interview",
    thesis: "对谈围绕产品判断展开。",
    keyPoints: [
      {
        id: "point-existing",
        timestamp: 12,
        text: "先确认用户真正的问题。",
        evidence: [{ start: 12, text: "原缓存中的证据" }],
      },
    ],
    chapters: [],
    extras: { title: "嘉宾观点", items: ["先理解问题"] },
  };

  const document = normalizeSummaryDocument(cached, { cues });

  assert.equal(document.keyPoints[0].id, "point-existing");
  assert.deepEqual(document.keyPoints[0].evidence, [{ start: 12, text: "原缓存中的证据" }]);
  assert.deepEqual(document.selfTest, []);
});

test("自测问题会被规范化、吸附到真实字幕时刻并导出为 Markdown", () => {
  const document = parseSummaryResponse(
    JSON.stringify({
      videoType: "lecture",
      thesis: "这堂课解释了梯度下降的原理。",
      keyPoints: [{ timestamp: "00:12", text: "学习率决定步长。" }],
      chapters: [],
      extras: null,
      selfTest: [
        { timestamp: "00:13", question: "学习率过大会发生什么？", answer: "步长过大，损失可能震荡发散。" },
        { timestamp: "", question: "", answer: "无效项应被过滤" },
      ],
    }),
    { cues }
  );

  assert.equal(document.selfTest.length, 1);
  assert.equal(document.selfTest[0].id, "quiz-1");
  assert.equal(document.selfTest[0].timestamp, 12);
  assert.equal(document.selfTest[0].question, "学习率过大会发生什么？");

  const markdown = summaryDocumentToMarkdown(document);
  assert.match(markdown, /## 自测问题/);
  assert.match(markdown, /- \[0:12\] 学习率过大会发生什么？/);
  assert.match(markdown, /答案：步长过大，损失可能震荡发散。/);
});

test("关联视频被规范化：非法关系回退、缺字段过滤、可导出", () => {
  const document = parseSummaryResponse(
    JSON.stringify({
      videoType: "tutorial",
      thesis: "本视频讲解向量检索。",
      keyPoints: [],
      chapters: [],
      extras: null,
      connections: [
        { videoId: "rag1", videoTitle: "RAG 入门", relation: "延伸", text: "本视频把上次的检索策略推进到混合检索。" },
        { videoId: "bad", videoTitle: "x", relation: "随便写的", text: "关系不合法会回退。" },
        { videoId: "", text: "缺 videoId 会被过滤。" },
        { videoId: "keep", videoTitle: "无文案", relation: "印证", text: "" },
      ],
    }),
    { cues }
  );

  assert.equal(document.connections.length, 2);
  assert.equal(document.connections[0].relation, "延伸");
  assert.equal(document.connections[1].relation, "关联");

  const markdown = summaryDocumentToMarkdown(document);
  assert.match(markdown, /## 关联视频/);
  assert.match(markdown, /- 【延伸】本视频把上次的检索策略推进到混合检索。（《RAG 入门》）/);
});
