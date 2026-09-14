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

  assert.equal(document.version, 2);
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

  assert.equal(document.version, 2);
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
});
