#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const connectorDir = dirname(fileURLToPath(import.meta.url));
const nodePath = process.execPath;
const userHome = homedir();
const userName = process.env.USER || process.env.LOGNAME || "";
const agyPath = process.env.ANTIGRAVITY_CLI_PATH || join(userHome, ".local", "bin", "agy");
const connectorPort = process.env.ANTIGRAVITY_CONNECTOR_PORT || "17374";
const label = "com.youtube-summary.antigravity-connector";
const agentsDir = join(userHome, "Library", "LaunchAgents");
const logsDir = join(userHome, "Library", "Logs");
const plistPath = join(agentsDir, `${label}.plist`);
const uid = process.getuid();

const xmlEscape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const proxyKeys = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

const envEntries = [
  `    <key>ANTIGRAVITY_CLI_PATH</key><string>${xmlEscape(agyPath)}</string>`,
  `    <key>ANTIGRAVITY_CONNECTOR_PORT</key><string>${xmlEscape(connectorPort)}</string>`,
  `    <key>HOME</key><string>${xmlEscape(userHome)}</string>`,
  `    <key>USER</key><string>${xmlEscape(userName)}</string>`,
  `    <key>LOGNAME</key><string>${xmlEscape(userName)}</string>`,
  `    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:${xmlEscape(join(userHome, ".local", "bin"))}:/usr/bin:/bin</string>`,
  `    <key>LANG</key><string>zh_CN.UTF-8</string>`,
  `    <key>LC_ALL</key><string>zh_CN.UTF-8</string>`,
];

for (const key of proxyKeys) {
  if (process.env[key]) {
    envEntries.push(`    <key>${xmlEscape(key)}</key><string>${xmlEscape(process.env[key])}</string>`);
  }
}

mkdirSync(agentsDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(join(connectorDir, "server.mjs"))}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries.join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xmlEscape(join(logsDir, `${label}.log`))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(logsDir, `${label}.error.log`))}</string>
</dict>
</plist>
`);

try {
  execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" });
} catch (error) {
  // 首次安装时服务不存在，继续注册即可。
}
execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
execFileSync("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`]);

console.log("Antigravity 本地连接器已安装并启动。现在可以回到插件中连接并选择模型。");
