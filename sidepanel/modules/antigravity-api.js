export const DEFAULT_CONNECTOR_URL = "http://127.0.0.1:17374";

function connectorUrl(raw) {
  return String(raw || DEFAULT_CONNECTOR_URL).trim().replace(/\/+$/, "");
}

async function connectorRequest(baseUrl, path, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${connectorUrl(baseUrl)}${path}`, options);
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new Error(
      "Antigravity 本地连接器未启动，请先双击 connector/start.command"
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Antigravity 连接失败（${response.status}）`);
  }
  return response;
}

export async function getAntigravityStatus(baseUrl, fetchImpl = fetch) {
  const response = await connectorRequest(baseUrl, "/health", {}, fetchImpl);
  return response.json();
}

export async function getAntigravityModels(baseUrl, fetchImpl = fetch) {
  const response = await connectorRequest(baseUrl, "/models", {}, fetchImpl);
  const body = await response.json();
  return Array.isArray(body.models) ? body.models : [];
}

export function pickDefaultAntigravityModel(models) {
  const ids = (Array.isArray(models) ? models : []).map((model) => model.id);
  return ids.find((id) => /^gemini-[\d.]+-flash-low$/.test(id))
    || ids.find((id) => id.startsWith("gemini-") && id.endsWith("-low"))
    || ids[0]
    || "";
}

export async function antigravityChatStream({
  settings,
  messages,
  onDelta,
  signal,
  fetchImpl = fetch,
}) {
  const response = await connectorRequest(
    settings.apiUrl,
    "/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: settings.model, messages }),
      signal,
    },
    fetchImpl
  );
  if (!response.body) throw new Error("Antigravity 连接器没有返回内容");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const consume = (block) => {
    const line = block
      .split(/\r?\n/)
      .find((item) => item.trim().startsWith("data:"));
    if (!line) return;
    const payload = line.slice(line.indexOf("data:") + 5).trim();
    if (!payload || payload === "[DONE]") return;
    const event = JSON.parse(payload);
    if (event.error) throw new Error(event.error);
    if (typeof event.final === "string" && event.final) {
      full = event.final;
      if (onDelta) onDelta(full);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consume(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!full.trim()) throw new Error("Antigravity 模型没有返回内容，请换一个模型试试");
  return full;
}
