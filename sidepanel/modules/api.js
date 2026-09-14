// OpenAI 兼容接口客户端：支持任意 /v1/chat/completions 服务
// （OpenAI / DeepSeek / Kimi / 中转站 / Ollama / LM Studio …）

import {
  antigravityChatStream,
  getAntigravityStatus,
} from "./antigravity-api.js";

// 用户可能只填域名或 /v1 结尾的基础地址，统一补全成完整 endpoint
export function normalizeApiUrl(raw) {
  let u = (raw || "").trim().replace(/\s+/g, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v\d+[a-z]*$/i.test(u)) return u + "/chat/completions";
  return u + "/v1/chat/completions";
}

// 剥掉推理模型输出的 <think>…</think> 段（含未闭合的情况）
export function stripThink(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const open = t.indexOf("<think>");
  if (open !== -1) t = t.slice(0, open);
  return t;
}

function friendlyError(status, bodyText) {
  let detail = "";
  try {
    const j = JSON.parse(bodyText);
    detail = (j.error && (j.error.message || j.error.code)) || j.message || "";
  } catch (e) {
    detail = (bodyText || "").slice(0, 200);
  }
  const map = {
    400: "请求被拒绝（参数不兼容或模型名错误）",
    401: "API Key 无效或未授权",
    403: "没有权限访问该接口/模型",
    404: "接口路径不存在，请检查 API 地址是否正确",
    429: "请求过于频繁或额度不足",
  };
  const base = map[status] || (status >= 500 ? `服务端错误（${status}）` : `请求失败（${status}）`);
  return detail ? `${base}：${detail}` : base;
}

async function request(settings, body, signal) {
  const url = normalizeApiUrl(settings.apiUrl);
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new Error(
      `无法连接到 ${url}，请检查地址是否可达、是否输错。本地服务（Ollama 等）需填 http://`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyError(res.status, text));
  }
  return res;
}

// 测试连接：发一条最小对话，非流式，返回耗时与结果
export async function testConnection(settings) {
  const t0 = performance.now();
  if (settings.provider === "antigravity") {
    await getAntigravityStatus(settings.apiUrl);
    return { latency: Math.round(performance.now() - t0), reply: "ready" };
  }
  const res = await request(settings, {
    model: settings.model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 5,
  });
  const latency = Math.round(performance.now() - t0);
  const data = await res.json().catch(() => null);
  const reply =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  return { latency, reply: typeof reply === "string" ? reply.slice(0, 40) : "" };
}

// 流式对话。onDelta 收到的始终是「过滤 think 标签后的完整文本」，直接整段渲染即可
export async function chatStream({ settings, messages, onDelta, signal, temperature = 0.4 }) {
  if (settings.provider === "antigravity") {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = stripThink(await antigravityChatStream({
        settings,
        messages,
        signal,
        onDelta: (full) => onDelta && onDelta(stripThink(full)),
      }));
      if (!text.includes("\uFFFD")) return text;
    }
    throw new Error("Antigravity 返回了损坏的字符编码，请重新生成");
  }
  const res = await request(
    settings,
    { model: settings.model, messages, stream: true, temperature },
    signal
  );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";

  const emit = () => onDelta && onDelta(stripThink(raw));

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta =
          j.choices &&
          j.choices[0] &&
          ((j.choices[0].delta && j.choices[0].delta.content) ||
            (j.choices[0].message && j.choices[0].message.content));
        if (typeof delta === "string" && delta) {
          raw += delta;
          emit();
        }
      } catch (e) {
        // 忽略无法解析的行（心跳注释等）
      }
    }
  }
  emit();
  if (!raw.trim()) throw new Error("模型没有返回内容，请换一个模型试试");
  return stripThink(raw);
}
