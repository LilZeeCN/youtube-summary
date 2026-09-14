// 本地 mock API：OpenAI 兼容的 /v1/chat/completions，用于无 Key 时验证插件全链路
// 用法：node tools/mock-api.js  （默认端口 8907，插件设置里填 http://localhost:8907/v1）

const http = require("http");

const PORT = Number(process.env.PORT || 8907);

const SUMMARY = `## 一句话总结
这是一条来自本地 Mock 服务的示例总结：视频讲解了 Chrome 扩展从零到一的完整开发流程。

## 关键要点
- [00:12] 扩展由 manifest、后台脚本、内容脚本、侧边栏四部分组成
- [01:45] 侧边栏通过 chrome.tabs.sendMessage 与内容脚本通信
- [03:20] YouTube 字幕从播放器的 captionTracks 接口提取
- [05:02] 流式输出让总结边生成边显示，体验更好

## 章节摘要
### [00:05] 项目结构
介绍 manifest 与各个文件的职责划分。
### [02:10] 消息通信
演示侧边栏、内容脚本、页面世界三者之间的请求与响应链路。
### [04:00] 字幕与总结
提取带时间戳的字幕并交给 AI 分层总结。`;

const MINDMAP = JSON.stringify({
  label: "Chrome 扩展开发",
  t: 0,
  children: [
    {
      label: "项目结构",
      t: 5,
      children: [
        { label: "manifest 配置", t: 12 },
        { label: "后台 Service Worker", t: 40 },
        { label: "侧边栏 UI", t: 95 },
      ],
    },
    {
      label: "消息通信",
      t: 130,
      children: [
        { label: "tabs.sendMessage", t: 145 },
        { label: "window.postMessage 桥接", t: 200 },
      ],
    },
    {
      label: "AI 能力",
      t: 240,
      children: [
        { label: "流式对话 SSE", t: 250 },
        { label: "长文本分段总结", t: 300 },
      ],
    },
  ],
});

const CHAT_REPLY = `根据字幕内容，这一段讲解的是**消息通信机制**：

- [02:10] 侧边栏发起请求，内容脚本接收后转发到页面世界
- [02:45] 页面世界读取播放器数据后原路返回

如果想在视频中查看细节，点击上面的时间戳即可跳转。`;

function replyFor(body) {
  const sys = (body.messages || []).find((m) => m.role === "system");
  const sysText = sys ? String(sys.content) : "";
  if (sysText.includes("思维导图")) return MINDMAP;
  if (sysText.includes("术语校对员")) return "PAGENT、pi agent → Pi Agent";
  if (sysText.includes("要点") && sysText.includes("部分")) return "- [00:10] 第一部分要点：项目结构与职责\n- [01:20] 第二部分要点：消息链路";
  if (sysText.includes("学习助手")) return CHAT_REPLY;
  return SUMMARY;
}

function sseWrap(delta) {
  return (
    "data: " +
    JSON.stringify({ choices: [{ delta: { content: delta }, index: 0 }] }) +
    "\n\n"
  );
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && req.url.includes("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
  }

  if (req.method === "POST" && req.url.includes("/chat/completions")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch (e) {}
      const reply = replyFor(body);
      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        let i = 0;
        const step = 6;
        const timer = setInterval(() => {
          if (i >= reply.length) {
            clearInterval(timer);
            res.write("data: [DONE]\n\n");
            return res.end();
          }
          res.write(sseWrap(reply.slice(i, i + step)));
          i += step;
        }, 15);
        req.on("close", () => clearInterval(timer));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: reply }, index: 0 }],
          })
        );
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found: " + req.url } }));
});

server.listen(PORT, () => {
  console.log(`mock api listening on http://localhost:${PORT}/v1 (model: mock-model)`);
});
