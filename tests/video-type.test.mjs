import assert from "node:assert/strict";
import test from "node:test";

import { inferVideoType, summaryExtraSpec } from "../sidepanel/modules/video-type.js";

const fixtures = [
  {
    expected: "tutorial",
    title: "从零开始：用 Agent 搭建自动化工作流教程",
    description: "安装、配置并完成第一个项目",
  },
  {
    expected: "interview",
    title: "产品经理访谈：和创业者聊 AI 产品",
    description: "本期嘉宾分享了自己的判断",
  },
  {
    expected: "review",
    title: "新款相机深度评测：到底值不值得买？",
    description: "画质、续航与同价位产品对比",
  },
  {
    expected: "news",
    title: "本周 AI 新闻：重要模型发布与行业更新",
    description: "梳理事件时间线及其影响",
  },
];

for (const fixture of fixtures) {
  test(`能识别 ${fixture.expected} 类型视频`, () => {
    assert.equal(inferVideoType(fixture), fixture.expected);
  });
}

test("不同内容类型会得到不同的补充信息目标", () => {
  assert.deepEqual(summaryExtraSpec("tutorial"), {
    title: "实践步骤",
    guidance: "提取观众可以照着执行的步骤、必要条件与最终产出；没有明确步骤时如实说明。",
  });
  assert.equal(summaryExtraSpec("interview").title, "嘉宾观点");
  assert.equal(summaryExtraSpec("review").title, "选择建议");
});
