const TYPE_RULES = {
  tutorial: ["教程", "入门", "从零", "实操", "手把手", "安装", "配置", "搭建", "how to", "guide"],
  interview: ["访谈", "采访", "对谈", "嘉宾", "播客", "podcast", "圆桌"],
  review: ["评测", "测评", "上手", "值得买吗", "值不值得", "对比", "review", "体验报告"],
  lecture: ["课程", "讲座", "公开课", "课堂", "原理", "理论", "lesson", "lecture"],
  news: ["新闻", "快讯", "发布会", "发布", "更新", "事件", "时间线", "行业动态", "news"],
};

// 各类型的「最佳总结形态」：thesis 怎么开头、要点抓什么、补充区块按什么骨架组织。
const EXTRA_SPECS = {
  tutorial: {
    title: "上手指南",
    guidance:
      "按「前置条件 / 操作步骤 / 结果验证 / 常见坑」组织，每条以类别开头（如「前置：」「步骤：」）。操作步骤保留具体命令、参数与顺序；结果验证说明完成后应看到什么；视频没讲的类别直接跳过，不要编造。",
    thesisHint: "thesis 先说看完能做出什么成果、适合谁，不要复述视频流程。",
    pointHint: "关键要点优先覆盖流程节点、关键参数和容易出错的环节。",
  },
  interview: {
    title: "嘉宾观点",
    guidance:
      "提取各位嘉宾最有区分度的判断和理由，注明是谁的观点；观点交锋或分歧处并列呈现；保留 1~2 句最有代表性、可原话引用的金句（注明说话人）。",
    thesisHint: "thesis 概括这场对话最核心的观点共识或交锋，点出是谁的判断。",
    pointHint: "关键要点优先覆盖观点判断及其理由，注明持方。",
  },
  review: {
    title: "选择建议",
    guidance:
      "按「结论 / 优点 / 不足 / 适合与不适合的人群」组织，每条以类别开头；结论必须明确回答值不值得；只依据视频给出的体验和比较。",
    thesisHint: "thesis 必须先给出「值不值得」的明确结论，再概括核心理由。",
    pointHint: "关键要点优先覆盖分维度的对比结论。",
  },
  lecture: {
    title: "概念脉络",
    guidance:
      "按「问题定义 → 核心概念（是什么、为什么需要）→ 推理链 → 关键例子」组织，说清概念间的关系与前置知识。",
    thesisHint: "thesis 点明这堂课要解决的核心问题和给出的答案。",
    pointHint: "关键要点优先覆盖概念结论与推理链条。",
  },
  news: {
    title: "事实与影响",
    guidance:
      "严格区分并标注三类内容：「事实」是已发生的事；「判断」是视频作者的观点；「影响」是可能的后续发展。不要把推测写成事实。",
    thesisHint: "thesis 先陈述最核心的新闻事实，再带出其意义。",
    pointHint: "关键要点优先覆盖核心事实与关键变化。",
  },
  general: {
    title: "值得记住",
    guidance: "补充主干总结之外最值得保留的事实、方法或限制，避免重复。",
    thesisHint: "",
    pointHint: "",
  },
};

function keywordScore(text, keywords, weight) {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? weight : 0), 0);
}

export function inferVideoType({ title = "", description = "", transcriptSample = "" } = {}) {
  const titleText = String(title).toLowerCase();
  const descriptionText = String(description).toLowerCase();
  const transcriptText = String(transcriptSample).toLowerCase().slice(0, 5000);
  let bestType = "general";
  let bestScore = 0;

  for (const [type, keywords] of Object.entries(TYPE_RULES)) {
    const score =
      keywordScore(titleText, keywords, 4) +
      keywordScore(descriptionText, keywords, 1.5) +
      keywordScore(transcriptText, keywords, 0.25);
    if (score > bestScore) {
      bestType = type;
      bestScore = score;
    }
  }
  return bestType;
}

export function summaryExtraSpec(videoType) {
  return EXTRA_SPECS[videoType] || EXTRA_SPECS.general;
}

export function videoTypeLabel(videoType) {
  return {
    tutorial: "教程",
    interview: "访谈",
    review: "评测",
    lecture: "课程",
    news: "资讯",
    general: "综合",
  }[videoType] || "综合";
}
