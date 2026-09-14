// 迷你 Markdown 渲染器：支持 AI 输出的常用子集（标题/列表/粗体/行内代码/代码块/链接），
// 并把 [mm:ss] / [h:mm:ss] / [起-止] 时间戳渲染成可点击跳转的胶囊按钮（data-t 为秒数）。

import { renderInlineMath, renderDisplayMath } from "./math.js";
import { renderRelationDiagram } from "./relation-diagram.js";

const TS_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[-–~]\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]/g;

// 行内公式：$ 后不能紧跟空白、$ 前不能紧贴空白、闭合 $ 后不能是数字（放过 "$100 和 $200"）
const INLINE_MATH_RE = /\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function tsToSeconds(ts) {
  const p = ts.split(":").map(Number);
  if (p.some(isNaN)) return null;
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}

function renderTimestamps(html) {
  return html.replace(TS_RE, (whole, start, end) => {
    const sec = tsToSeconds(start);
    if (sec === null) return whole;
    const label = end ? `${start}–${end}` : start;
    return `<button class="ts" data-t="${sec}" type="button">${label}</button>`;
  });
}

function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 公式先于粗体/斜体抽成占位符，公式内的 * _ 等字符才不会被误当成强调标记
  const maths = [];
  s = s.replace(INLINE_MATH_RE, (_, body) => {
    maths.push(renderInlineMath(body));
    return `\u0001${maths.length - 1}\u0001`;
  });
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => maths[Number(i)]);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return renderTimestamps(s);
}

// GFM 表格：拆单元格（容忍无外层管道符的写法）
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

const isTableSeparator = (line) =>
  /^[\s|:-]+$/.test(line) && line.includes("-") && line.includes("|");

function renderTable(header, sep, rows) {
  const aligns = sep.map((s) => {
    if (s.startsWith(":") && s.endsWith(":")) return "center";
    if (s.endsWith(":")) return "right";
    return "";
  });
  const th = header
    .map((c, i) => `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${inline(c)}</th>`)
    .join("");
  const trs = rows
    .map(
      (r) =>
        `<tr>${header
          .map((_, i) => `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${inline(r[i] || "")}</td>`)
          .join("")}</tr>`
    )
    .join("");
  // 表格套独立横向滚动容器：窄屏下只有表格本身可滑，不撑开外层布局
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

export function renderMarkdown(src) {
  const lines = String(src || "").split(/\r?\n/);
  const out = [];
  let list = null; // "ul" | "ol"
  let inCode = false;
  let codeBuf = [];
  let codeLang = "";
  let inMath = false;
  let mathBuf = [];
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\s+$/, "");

    if (/^```/.test(line.trim())) {
      if (inCode) {
        const code = codeBuf.join("\n");
        const diagram = codeLang === "relation" ? renderRelationDiagram(code) : "";
        out.push(diagram || `<pre><code>${escapeHtml(code)}</code></pre>`);
        codeBuf = [];
        codeLang = "";
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
        codeLang = line.trim().slice(3).trim().toLowerCase();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(rawLine);
      continue;
    }

    // 块级公式：单行 $$…$$ 直接渲染；否则按成对 $$ 围栏收集（同代码块的处理方式）
    if (inMath) {
      mathBuf.push(rawLine);
      const t = line.trim();
      if (t.endsWith("$$")) {
        mathBuf[mathBuf.length - 1] = t.slice(0, -2);
        out.push(renderDisplayMath(mathBuf.join("\n").trim()));
        inMath = false;
        mathBuf = [];
      }
      continue;
    }
    if (/^\$\$/.test(line.trim())) {
      flushPara();
      flushList();
      const t = line.trim();
      if (t.endsWith("$$") && t.length > 4) {
        out.push(renderDisplayMath(t.slice(2, -2).trim()));
      } else {
        inMath = true;
        mathBuf = [t.slice(2)];
      }
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    // 表格：当前行含 | 且下一行是 |---|---| 形态的分隔行
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      flushList();
      const header = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) {
        rows.push(splitRow(lines[j]));
        j++;
      }
      out.push(renderTable(header, sep, rows));
      i = j - 1;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      const level = Math.min(h[1].length + 1, 5); // h2 起，避免标题过大
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== "ul") {
        flushList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        flushList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push("<hr>");
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  if (inCode && codeLang === "relation") {
    out.push('<div class="relation-diagram-loading" role="status"><span></span>正在绘制关系图…</div>');
  } else if (inCode && codeBuf.length) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  if (inMath && mathBuf.length) {
    out.push(renderDisplayMath(mathBuf.join("\n").trim()));
  }
  flushPara();
  flushList();
  return out.join("\n");
}
