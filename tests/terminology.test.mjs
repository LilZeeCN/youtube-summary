import assert from "node:assert/strict";
import test from "node:test";

const terminology = await import(
  new URL("../sidepanel/modules/terminology.js", import.meta.url)
);

test("the spelling from the video title overrides an ASR spelling", () => {
  const guide = terminology.normalizeTerminologyGuide(
    "Pi Agent、pi agent → PAGENT",
    "00-20 分钟 学会 Pi Agent"
  );

  assert.equal(guide, "PAGENT → Pi Agent");
});

test("a close ASR spelling is mapped to the title even when the model omitted it", () => {
  const guide = terminology.normalizeTerminologyGuide(
    "p agent → PAGENT",
    "Pi Agent 架构详解"
  );

  assert.equal(guide, "p agent、PAGENT → Pi Agent");
});

test("unrelated terminology mappings are left unchanged", () => {
  const guide = terminology.normalizeTerminologyGuide(
    "py torch → PyTorch",
    "Pi Agent 架构详解"
  );

  assert.equal(guide, "py torch → PyTorch");
});

test("the corrected guide is enforced on generated summary text", () => {
  const text = terminology.applyTerminologyGuide(
    "PAGENT 可以调用工具，p agent 也支持上下文管理。",
    "PAGENT、p agent → Pi Agent"
  );

  assert.equal(text, "Pi Agent 可以调用工具，Pi Agent 也支持上下文管理。");
});
