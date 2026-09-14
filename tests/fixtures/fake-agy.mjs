#!/usr/bin/env node

import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("1.1.13\n");
  process.exit(0);
}

if (args[0] === "models") {
  process.stdout.write("Fetching available models...\n");
  process.stdout.write("gemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n");
  process.stdout.write("gemini-3.1-pro-high\tGemini 3.1 Pro (High)\n");
  process.stdout.write("claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n");
  process.exit(0);
}

if (args.includes("-p")) {
  const prompt = args[args.indexOf("-p") + 1] || "";
  if (prompt.includes("[地区限制测试]")) {
    const logIndex = args.indexOf("--log-file");
    if (logIndex >= 0 && args[logIndex + 1]) {
      writeFileSync(
        args[logIndex + 1],
        "agent executor error: FAILED_PRECONDITION (code 400): User location is not supported for the API use.\n"
      );
    }
    process.stdout.write(`${JSON.stringify({
      event: "result",
      result: {
        status: "ERROR",
        response: "",
        error: "Agent execution terminated due to error.",
      },
    })}\n`);
    process.exit(1);
  }
  if (prompt.includes("[输入清理测试]")) {
    const answer = prompt.includes("\uFFFD") ? "输入仍损坏" : "输入已清理";
    process.stdout.write(`${JSON.stringify({
      event: "result",
      result: { status: "SUCCESS", response: answer },
    })}\n`);
    process.exit(0);
  }
  if (prompt.includes("[最终文本校验测试]")) {
    process.stdout.write(`${JSON.stringify({
      event: "step_update",
      step_update: { step_type: "agent_response", text_delta: "依靠���密自动化" },
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      event: "result",
      result: { status: "SUCCESS", response: "依靠严密自动化" },
    })}\n`);
    process.exit(0);
  }
  const firstLine = Buffer.from(`${JSON.stringify({
    event: "step_update",
    step_update: { step_type: "agent_response", text_delta: "第一段" },
  })}\n`);
  const firstChineseByte = firstLine.indexOf(Buffer.from("第"));
  process.stdout.write(firstLine.subarray(0, firstChineseByte + 1));
  await new Promise((resolve) => setTimeout(resolve, 5));
  process.stdout.write(firstLine.subarray(firstChineseByte + 1));
  process.stdout.write(`${JSON.stringify({
    event: "step_update",
    step_update: { step_type: "agent_response", text_delta: "，第二段" },
  })}\n`);
  process.stdout.write(`${JSON.stringify({
    event: "result",
    result: { status: "SUCCESS", response: "第一段，第二段" },
  })}\n`);
  process.exit(0);
}

process.stderr.write(`unsupported fake agy invocation: ${args.join(" ")}\n`);
process.exit(2);
