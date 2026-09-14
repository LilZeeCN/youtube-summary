import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDescriptionChapters,
  segmentTranscript,
} from "../sidepanel/modules/transcript-segmentation.js";

function cue(start, text = "这是一句用于测试分段边界的字幕") {
  return { start, text };
}

test("能从常见视频描述格式中读取官方章节", () => {
  assert.deepEqual(
    parseDescriptionChapters("00:00 开场\n00:30 - 核心方法\n[1:02:03] 深入讨论\n普通说明"),
    [
      { start: 0, title: "开场" },
      { start: 30, title: "核心方法" },
      { start: 3723, title: "深入讨论" },
    ]
  );
});

test("长字幕优先在接近预算的官方章节处分段，并保留上下文重叠", () => {
  const cues = [0, 10, 20, 30, 40, 50, 60].map((start) => cue(start));
  const chunks = segmentTranscript(cues, {
    maxChars: 70,
    description: "00:00 开场\n00:30 核心方法",
    overlapCues: 2,
  });

  assert.equal(chunks[0].end, 30);
  assert.equal(chunks[0].boundaryReason, "chapter");
  assert.equal(chunks[0].nextChapterTitle, "核心方法");
  assert.deepEqual(chunks[1].cues.slice(0, 2).map((item) => item.start), [10, 20]);
  assert.equal(chunks[1].overlapCount, 2);
});

test("没有官方章节时优先利用明显停顿，而不是生硬按字符切断", () => {
  const cues = [cue(0), cue(5), cue(10), cue(42), cue(47), cue(52)];
  const chunks = segmentTranscript(cues, { maxChars: 100, overlapCues: 1 });

  assert.equal(chunks[0].end, 42);
  assert.equal(chunks[0].boundaryReason, "pause");
  assert.equal(chunks[1].cues[0].start, 10);
});
