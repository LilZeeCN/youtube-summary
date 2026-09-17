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
    assert.match(prompt, /suggestedQuestions/);
    assert.match(prompt, /每条不超过 22 个字/);
  }
  assert.match(system, /空泛表述/);
});

test("建议追问要求落到具体内容并利用记忆与内容类型", () => {
  const system = prompts.summarySystemPrompt("review", {}, true);
  assert.match(system, /点名视频里真实出现的概念/);
  assert.match(system, /按内容类型选题/);
  assert.match(system, /其中一条应利用记忆/);
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

test("记忆上下文注入与关联规则按开关生效", () => {
  const withMemory = prompts.summarySystemPrompt("general", {}, true);
  assert.match(withMemory, /connections/);
  assert.match(withMemory, /校准深度/);
  assert.doesNotMatch(prompts.summarySystemPrompt("general", {}, false), /校准深度/);

  const block = prompts.memoryContextBlock({
    facts: ["用户是前端工程师"],
    relatedVideos: [{ videoId: "rag1", title: "RAG 入门", thesis: "检索增强流程" }],
    topics: [{ name: "RAG", note: "已了解流程" }],
  });
  assert.match(block, /【用户记忆/);
  assert.match(block, /- 用户是前端工程师/);
  assert.match(block, /- rag1｜《RAG 入门》｜检索增强流程/);
  assert.match(block, /- RAG：已了解流程/);
  assert.equal(prompts.memoryContextBlock(null), "");
});

test("睡眠期整合提示词带数量上限并要求输出完整 JSON", () => {
  const system = prompts.memoryConsolidationSystemPrompt({ maxFacts: 24, maxTopics: 60 });
  assert.match(system, /facts 不超过 24 条/);
  assert.match(system, /topics 不超过 60 条/);
  assert.match(system, /"facts"/);
  assert.match(system, /"topics"/);
});

test("用户提示词在提供记忆时插入记忆块", () => {
  const user = prompts.summaryUserPrompt("[00:10] 字幕", "标题", 60, "", "general", "【用户记忆（这位观众的既有认知，用于校准深度与建立视频间关联）】\n- 用户是前端工程师");
  assert.match(user, /【用户记忆/);
  assert.match(user, /字幕如下/);
  const plain = prompts.summaryUserPrompt("[00:10] 字幕", "标题", 60, "", "general");
  assert.doesNotMatch(plain, /【用户记忆/);
});

test("对话在提供相关视频时给出引用规则与上下文块", () => {
  const sys = prompts.chatSystemPrompt("标题", false, true);
  assert.match(sys, /用户看过的相关视频/);
  assert.match(sys, /《视频标题》/);
  assert.match(sys, /禁止编造标题/);
  assert.match(sys, /时间戳只属于当前视频/);
  assert.doesNotMatch(prompts.chatSystemPrompt("标题", false, false), /禁止编造标题/);

  const ctx = prompts.chatContextText({
    memoryVideos: [
      { videoId: "rag1", title: "RAG 入门", thesis: "检索增强流程", keyPoints: ["向量检索是第一步。", "重排提升精度。"] },
    ],
  });
  assert.match(ctx, /【用户看过的相关视频（回答可引用，标题写成《…》）】/);
  assert.match(ctx, /- 《RAG 入门》：检索增强流程/);
  assert.match(ctx, /要点：向量检索是第一步。；重排提升精度。/);
  const empty = prompts.chatContextText({});
  assert.doesNotMatch(empty, /相关视频/);
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
