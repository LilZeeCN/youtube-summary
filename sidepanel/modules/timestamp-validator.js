// 时间戳后验校验：时间戳点击跳转是本项目的招牌功能，但模型偶尔会输出
// 字幕里不存在的时刻。生成完成后用确定性代码把输出中的 [mm:ss] 对齐到
// 真实字幕时间轴：轻微偏差吸附到最近字幕，明显越界（超出全片结尾）的
// 移除时间戳保留文字。纯本地计算，不产生额外 API 调用。

import { parseTimestamp } from "./subtitles.js";

// 吸附容差：字幕（尤其 ASR）间隔通常只有几秒，10 秒内视为同一处的轻微偏差
const SNAP_TOLERANCE_SEC = 10;

// 与 markdown.js 的渲染规则同族：支持 [mm:ss] / [h:mm:ss] / [起-止] 区间。
// 结尾可选捕获一个空格：移除时间戳时一并吃掉，避免留下双空格。
const TS_TOKEN_RE = /\[(\d{1,3}:\d{2}(?::\d{2})?)(?:\s*[-–~]\s*(\d{1,3}:\d{2}(?::\d{2})?))?\]( ?)/g;

// 分钟补满两位（[mm:ss]），与提示词要求模型输出的格式保持一致
function formatStamp(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function nearestStart(starts, t) {
  let lo = 0;
  let hi = starts.length - 1;
  if (t <= starts[lo]) return starts[lo];
  if (t >= starts[hi]) return starts[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid;
  }
  return t - starts[lo] <= starts[hi] - t ? starts[lo] : starts[hi];
}

// 单个时间戳的裁决：snap=吸附到真实字幕时刻；keep=在时间轴内但远离任何字幕
// （长静音/无字幕段，仍是有效视频时间，保留原文）；drop=明显越界，移除
function resolveStamp(ts, starts) {
  const t = parseTimestamp(ts);
  if (t === null) return { type: "keep" };
  const nearest = nearestStart(starts, t);
  if (Math.abs(t - nearest) <= SNAP_TOLERANCE_SEC) return { type: "snap", sec: nearest };
  if (t > starts[starts.length - 1] || t < starts[0]) return { type: "drop" };
  return { type: "keep" };
}

export function validateTimestamps(text, cues) {
  if (!text || !Array.isArray(cues) || !cues.length) return text;
  const starts = cues
    .map((c) => Number(c && c.start))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (!starts.length) return text;

  return text.replace(TS_TOKEN_RE, (full, from, to, trailingSpace) => {
    const fromRes = resolveStamp(from, starts);
    const toRes = to ? resolveStamp(to, starts) : null;
    if (fromRes.type === "drop" || (toRes && toRes.type === "drop")) {
      return ""; // 越界时间戳跳转会落在视频外，移除标记但保留正文
    }
    const part = (res, original) =>
      res.type === "snap" ? formatStamp(res.sec) : original;
    const body = toRes
      ? `[${part(fromRes, from)}-${part(toRes, to)}]`
      : `[${part(fromRes, from)}]`;
    return body + (trailingSpace || "");
  });
}
