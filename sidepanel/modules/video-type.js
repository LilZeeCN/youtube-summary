const TYPE_RULES = {
  tutorial: ["教程", "入门", "从零", "实操", "手把手", "安装", "配置", "搭建", "how to", "guide"],
  interview: ["访谈", "采访", "对谈", "嘉宾", "播客", "podcast", "圆桌"],
  review: ["评测", "测评", "上手", "值得买吗", "值不值得", "对比", "review", "体验报告"],
  lecture: ["课程", "讲座", "公开课", "课堂", "原理", "理论", "lesson", "lecture"],
  news: ["新闻", "快讯", "发布会", "发布", "更新", "事件", "时间线", "行业动态", "news"],
};

const EXTRA_SPECS = {
  tutorial: {
    title: "实践步骤",
    guidance: "提取观众可以照着执行的步骤、必要条件与最终产出；没有明确步骤时如实说明。",
  },
  interview: {
    title: "嘉宾观点",
    guidance: "提取嘉宾最有区分度的判断、理由以及彼此一致或分歧之处。",
  },
  review: {
    title: "选择建议",
    guidance: "整理优点、限制、适合与不适合的人群；只依据视频给出的体验和比较。",
  },
  lecture: {
    title: "概念脉络",
    guidance: "整理核心概念、它们之间的关系以及理解它们所需的前置知识。",
  },
  news: {
    title: "事实与影响",
    guidance: "区分已发生的事实、视频作者的判断和可能影响，不把推测写成事实。",
  },
  general: {
    title: "值得记住",
    guidance: "补充主干总结之外最值得保留的事实、方法或限制，避免重复关键要点。",
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
