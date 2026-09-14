import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 17374;
const connectorDir = dirname(fileURLToPath(import.meta.url));

function defaultCliPath() {
  return process.env.ANTIGRAVITY_CLI_PATH || join(homedir(), ".local", "bin", "agy");
}

function isAllowedOrigin(origin) {
  return !origin || /^chrome-extension:\/\/[a-z0-9]+$/i.test(origin);
}

function sendJson(response, status, value, origin = "") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(value));
}

function parseModels(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(([id, name]) => id && name && id.startsWith("gemini-"))
    .map(([id, name]) => ({ id: id.trim(), name: name.trim() }));
}

function runCli(cliPath, args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
      } else {
        const cleanErr = stderr.trim();
        const reason = timedOut
          ? "Antigravity CLI 响应超时"
          : (cleanErr || `Antigravity CLI 调用失败（退出码 ${code}）`);
        const err = new Error(reason);
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16 * 1024 * 1024) throw new Error("请求内容过大");
  }
  return JSON.parse(body || "{}");
}

function promptFromMessages(messages) {
  const clean = Array.isArray(messages)
    ? messages
        .filter((message) => message && typeof message.content === "string")
        .map((message) => ({
          role: ["system", "assistant", "user"].includes(message.role) ? message.role : "user",
          content: message.content.replace(/\uFFFD+/g, "[无法识别字符]"),
        }))
    : [];
  return [
    "请根据下面的 messages 生成最终回复。system 消息优先级最高；只输出最终内容，不解释处理过程。",
    JSON.stringify(clean),
  ].join("\n\n");
}

function writeSse(response, value) {
  response.write(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`);
}

function consumeDiagnosticLog(logPath) {
  let content = "";
  try {
    content = readFileSync(logPath, "utf8");
  } catch (error) {
    // agy 可能在日志文件创建前就退出，此时继续使用 stdout/stderr 判断。
  }
  try {
    unlinkSync(logPath);
  } catch (error) {
    // 文件不存在或已被清理，无需影响响应。
  }
  return content;
}

function formatCliFailure({ stderr, diagnosticLog, resultError }) {
  const details = [stderr, diagnosticLog, resultError].filter(Boolean).join("\n");
  if (/User location is not supported for the API use/i.test(details)) {
    return "Antigravity 当前网络所在地区不支持 API 调用";
  }
  if (/auth|login|credential|not logged/i.test(details)) {
    return "Antigravity 登录凭据失效，请在终端运行 agy 重新登录";
  }
  const cleanErr = String(stderr || "").trim();
  if (cleanErr) return `Antigravity 调用失败: ${cleanErr.slice(0, 300)}`;
  const cleanResult = String(resultError || "").trim();
  if (cleanResult && cleanResult !== "Agent execution terminated due to error.") {
    return `Antigravity 调用失败: ${cleanResult.slice(0, 300)}`;
  }
  return "Antigravity 调用失败，agy 未返回具体原因";
}

function streamChat({ cliPath, model, messages, response }) {
  const diagnosticLogPath = join(tmpdir(), `youtube-summary-agy-${randomUUID()}.log`);
  const args = [
    "-p",
    promptFromMessages(messages),
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--agent",
    "video-summary",
    "--sandbox",
    "--disable-slash-commands",
    "--print-timeout",
    "10m",
    "--log-file",
    diagnosticLogPath,
  ];
  const child = spawn(cliPath, args, {
    cwd: join(connectorDir, "workspace"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let finalResponse = "";
  let resultError = "";
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  lines.on("line", (line) => {
    try {
      const event = JSON.parse(line);
      if (event.event === "result" && typeof event.result?.response === "string") {
        finalResponse = event.result.response;
      }
      if (event.event === "result" && typeof event.result?.error === "string") {
        resultError = event.result.error;
      }
    } catch (error) {
      // CLI 的普通提示或警告不是响应内容，忽略即可。
    }
  });

  child.on("error", (error) => {
    writeSse(response, { error: `无法启动 Antigravity CLI: ${error.message || "请确认本地连接器配置"}` });
    writeSse(response, "[DONE]");
    response.end();
  });
  child.on("close", (code) => {
    const diagnosticLog = consumeDiagnosticLog(diagnosticLogPath);
    if (response.writableEnded) return;
    if (code === 0) {
      if (finalResponse) writeSse(response, { final: finalResponse });
    } else {
      const errorMsg = formatCliFailure({ stderr, diagnosticLog, resultError });
      writeSse(response, { error: errorMsg });
    }
    writeSse(response, "[DONE]");
    response.end();
  });
  response.on("close", () => {
    if (!response.writableEnded && child.exitCode === null) child.kill("SIGTERM");
  });
}

export function createAntigravityServer({ cliPath = defaultCliPath() } = {}) {
  return createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    if (!isAllowedOrigin(origin)) {
      sendJson(response, 403, { ok: false, error: "不允许的请求来源" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
      response.end();
      return;
    }

    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const { stdout } = await runCli(cliPath, ["--version"], { timeout: 5000 });
        sendJson(response, 200, {
          ok: true,
          service: "antigravity-connector",
          cliVersion: stdout.trim(),
        }, origin);
      } catch (error) {
        sendJson(response, 503, {
          ok: false,
          error: error.message || "未找到可用的 Antigravity CLI",
        }, origin);
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/models") {
      try {
        const { stdout, stderr } = await runCli(cliPath, ["models"], { timeout: 60000 });
        const models = parseModels(stdout);
        if (!models.length) {
          const detail = (stderr || "").trim();
          throw new Error(detail || "没有可用的 Gemini 模型");
        }
        sendJson(response, 200, { ok: true, models }, origin);
      } catch (error) {
        const msg = error.message || "";
        const cleanMsg = msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("login")
          ? "读取 Antigravity 模型失败，请在终端运行 agy 重新登录"
          : (msg || "读取 Antigravity 模型失败，请在终端运行 agy models 确认状态");
        sendJson(response, 503, {
          ok: false,
          error: cleanMsg,
        }, origin);
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      try {
        const body = await readJsonBody(request);
        if (!String(body.model || "").startsWith("gemini-")) {
          sendJson(response, 400, { ok: false, error: "请选择可用的 Gemini 模型" }, origin);
          return;
        }
        if (!Array.isArray(body.messages) || !body.messages.length) {
          sendJson(response, 400, { ok: false, error: "对话内容不能为空" }, origin);
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
        });
        streamChat({ cliPath, model: body.model, messages: body.messages, response });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message || "请求格式错误" }, origin);
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "接口不存在" }, origin);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.ANTIGRAVITY_CONNECTOR_PORT || DEFAULT_PORT);
  const server = createAntigravityServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Antigravity connector is running at http://127.0.0.1:${port}`);
  });
}
