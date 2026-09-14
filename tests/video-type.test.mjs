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
  const tutorial = summaryExtraSpec("tutorial");
  assert.equal(tutorial.title, "上手指南");
  assert.match(tutorial.guidance, /前置条件.*操作步骤.*结果验证.*常见坑/s);
  assert.match(tutorial.thesisHint, /成果/);

  const interview = summaryExtraSpec("interview");
  assert.equal(interview.title, "嘉宾观点");
  assert.match(interview.guidance, /分歧/);
  assert.match(interview.guidance, /金句/);

  const review = summaryExtraSpec("review");
  assert.equal(review.title, "选择建议");
  assert.match(review.thesisHint, /值不值得/);

  const news = summaryExtraSpec("news");
  assert.equal(news.title, "事实与影响");
  assert.match(news.guidance, /事实.*判断.*影响/s);

  const lecture = summaryExtraSpec("lecture");
  assert.equal(lecture.title, "概念脉络");
  assert.match(lecture.guidance, /问题定义.*核心概念.*推理链.*关键例子/s);

  const general = summaryExtraSpec("general");
  assert.equal(general.title, "值得记住");
  assert.equal(general.thesisHint, "");
});
