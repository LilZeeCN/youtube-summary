import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSummaryQuality } from "../sidepanel/modules/summary-quality.js";

function point(id, timestamp, text, hasEvidence = true) {
  return {
    id,
    timestamp,
    text,
    evidence: hasEvidence ? [{ start: timestamp, text: `字幕依据：${text}` }] : [],
  };
}

test("覆盖全片且每条可核对的总结能通过本地质量门槛", () => {
  const result = evaluateSummaryQuality(
    {
      version: 2,
      videoType: "tutorial",
      thesis: "视频完整演示了一套工作流。",
      keyPoints: [
        point("p1", 0, "先明确输入和预期产出。"),
        point("p2", 90, "把处理步骤拆成独立节点。"),
        point("p3", 180, "逐个验证节点输出。"),
        point("p4", 270, "最后连接并运行完整流程。"),
      ],
      chapters: [],
      extras: null,
    },
    { duration: 300 }
  );

  assert.equal(result.pass, true);
  assert.equal(result.evidenceCoverage, 1);
  assert.equal(result.timelineCoverage, 0.9);
});

test("能指出缺少证据、覆盖不足和重复表述", () => {
  const result = evaluateSummaryQuality(
    {
      version: 2,
      videoType: "general",
      thesis: "一段总结。",
      keyPoints: [
        point("p1", 5, "作者介绍了这个重要方法。", false),
        point("p2", 8, "作者介绍了这个重要方法。", false),
        point("p3", 12, "作者说明了结果。", false),
      ],
      chapters: [],
      extras: null,
    },
    { duration: 600 }
  );

  assert.equal(result.pass, false);
  assert.ok(result.warnings.includes("evidence"));
  assert.ok(result.warnings.includes("timeline"));
  assert.ok(result.warnings.includes("repetition"));
});

test("占比过高的空话要点会被标记为 vagueness", () => {
  const result = evaluateSummaryQuality(
    {
      version: 3,
      videoType: "general",
      thesis: "一段总结。",
      keyPoints: [
        point("p1", 10, "视频介绍了很多相关内容。"),
        point("p2", 200, "作者讲解了一个重要的方法。"),
        point("p3", 400, "这部分分析了关键知识点。"),
        point("p4", 500, "结尾提到了一些总结。"),
      ],
      chapters: [],
      extras: null,
    },
    { duration: 600 }
  );

  assert.equal(result.vagueRatio, 1);
  assert.ok(result.warnings.includes("vagueness"));
});

test("带数字或英文术语的具体要点不会被误判为空话", () => {
  const result = evaluateSummaryQuality(
    {
      version: 3,
      videoType: "tutorial",
      thesis: "演示了完整流程。",
      keyPoints: [
        point("p1", 10, "把 chunk 大小设为 14000 字符。"),
        point("p2", 200, "介绍了 3 层架构的设计。"),
        point("p3", 400, "最后运行 npm test 验证。"),
      ],
      chapters: [],
      extras: null,
    },
    { duration: 600 }
  );

  assert.equal(result.vagueRatio, 0);
  assert.ok(!result.warnings.includes("vagueness"));
});

test("要点被章节摘要整句照抄会触发 overlap", () => {
  const copied = "先把输入拆分成多个块再逐段处理";
  const result = evaluateSummaryQuality(
    {
      version: 3,
      videoType: "general",
      thesis: "分层处理长文本。",
      keyPoints: [
        point("p1", 10, copied),
        point("p2", 200, "每段摘要后统一术语。"),
        point("p3", 400, "最后合并成完整总结。"),
      ],
      chapters: [
        { id: "chapter-1", timestamp: 0, title: "开始", summary: `${copied}，随后进入下一步。` },
      ],
      extras: null,
    },
    { duration: 600 }
  );

  assert.ok(result.warnings.includes("overlap"));
});

test("十分钟以上的章节只有一句话摘要会触发 chapterDepth", () => {
  const result = evaluateSummaryQuality(
    {
      version: 3,
      videoType: "lecture",
      thesis: "一堂关于检索增强的课。",
      keyPoints: [
        point("p1", 30, "先定义检索增强（RAG）的问题。"),
        point("p2", 400, "向量库选型影响召回率 5% 以上。"),
        point("p3", 900, "最后给出三步落地清单。"),
      ],
      chapters: [
        { id: "chapter-1", timestamp: 0, title: "问题定义", summary: "太短。" },
        { id: "chapter-2", timestamp: 700, title: "落地清单", summary: "给出可执行的落地步骤，包括建库、切分与评估三部分，并说明每一步的常见坑与验证方式。" },
      ],
      extras: null,
    },
    { duration: 1200 }
  );

  assert.ok(result.warnings.includes("chapterDepth"));
});
