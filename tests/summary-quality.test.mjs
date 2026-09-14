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
