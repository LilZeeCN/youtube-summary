import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../sidepanel/modules/prompts.js", import.meta.url), "utf8");
const prompts = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("summary prompts require contextual ASR correction and canonical terminology", () => {
  const system = prompts.summarySystemPrompt();

  assert.match(system, /ASR|语音识别/);
  assert.match(system, /上下文/);
  assert.match(system, /统一.*术语|术语.*统一/);
  assert.match(system, /不确定/);
});

test("summary prompts require self-test questions, concreteness and adaptive chapter length", () => {
  const system = prompts.summarySystemPrompt();
  const reduce = prompts.reduceSystemPrompt();

  for (const prompt of [system, reduce]) {
    assert.match(prompt, /selfTest/);
    assert.match(prompt, /自测|检验理解/);
    assert.match(prompt, /章节摘要的长度与章节时长匹配|时长匹配/);
  }
  assert.match(system, /空泛表述/);
});

test("type-specific guidance shapes thesis, key points and extras", () => {
  const review = prompts.summarySystemPrompt(
    "review",
    { title: "选择建议", guidance: "按结论组织。", thesisHint: "thesis 必须先给出「值不值得」的明确结论。", pointHint: "优先覆盖对比结论。" }
  );
  assert.match(review, /值不值得/);
  assert.match(review, /优先覆盖对比结论/);

  const plain = prompts.summarySystemPrompt("general", {});
  assert.doesNotMatch(plain, /undefined/);
  assert.match(plain, /覆盖视频主干/);
});

test("terminology prompts use the title and representative transcript", () => {
  const system = prompts.terminologySystemPrompt();
  const user = prompts.terminologyUserPrompt("PAGENT can use tools", "Pi Agent 入门");

  assert.match(system, /规范术语表/);
  assert.match(system, /变体/);
  assert.match(user, /Pi Agent 入门/);
  assert.match(user, /PAGENT can use tools/);
});

test("every long-video stage receives the same title and terminology guide", () => {
  const guide = "PAGENT、pi agent → Pi Agent";
  const chunk = prompts.chunkUserPrompt("[00:10] PAGENT", 1, 3, "Pi Agent 入门", guide);
  const reduce = prompts.reduceUserPrompt("[00:10] PAGENT supports tools", "Pi Agent 入门", guide);

  for (const prompt of [chunk, reduce]) {
    assert.match(prompt, /Pi Agent 入门/);
    assert.match(prompt, /PAGENT、pi agent → Pi Agent/);
  }
  assert.match(prompts.reduceSystemPrompt(), /矛盾/);
  assert.match(prompts.reduceSystemPrompt(), /统一.*术语|术语.*统一/);
});

test("video description reaches the summary and terminology prompts", () => {
  const desc = "章节：\n00:00 Intro\n00:40 Tool Loop\nPAGENT 全称 Pi Agent";
  const summary = prompts.summaryUserPrompt("[00:10] PAGENT", "Pi Agent 入门", 300, desc);
  const terminology = prompts.terminologyUserPrompt("PAGENT uses tools", "Pi Agent 入门", desc);

  for (const prompt of [summary, terminology]) {
    assert.match(prompt, /视频描述/);
    assert.match(prompt, /Pi Agent/);
    assert.match(prompt, /00:40 Tool Loop/);
  }
});

test("video description block is omitted and truncated when appropriate", () => {
  assert.doesNotMatch(
    prompts.summaryUserPrompt("[00:10] hi", "标题", 60, ""),
    /视频描述/
  );
  const long = "x".repeat(2000);
  const block = prompts.formatDescriptionBlock(long, 100);
  assert.match(block, /已截断/);
  assert.ok(block.length < 200);
});

test("deep-read prompt requires a renderable relationship diagram instead of a character tree", () => {
  const prompt = prompts.deepReadSystemPrompt();

  assert.match(prompt, /```relation/);
  assert.match(prompt, /"nodes"/);
  assert.match(prompt, /"edges"/);
  assert.match(prompt, /不要使用字符画|禁止使用字符画/);
  assert.match(prompt, /连线.*label.*不超过 6 个字/);
});
