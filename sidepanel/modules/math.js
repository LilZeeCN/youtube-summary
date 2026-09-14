// 迷你 LaTeX 渲染：把 AI 输出里的 $...$ / $$...$$ 数学公式转成 HTML。
// 项目零依赖，不追求完整 LaTeX，只覆盖视频讲解里最常见的子集
// （希腊字母、上下标、分式、根号、常用符号与重音）；无法识别的命令
// 去掉反斜杠按普通斜体词输出，宁可朴素也不错乱。

const GREEK = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", equiv: "≡",
  approx: "≈", sim: "∼", simeq: "≃", propto: "∝", ll: "≪", gg: "≫",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃",
  supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅",
  varnothing: "∅", land: "∧", wedge: "∧", lor: "∨", vee: "∨", neg: "¬",
  oplus: "⊕", ominus: "⊖", otimes: "⊗", odot: "⊙", perp: "⊥",
  parallel: "∥", angle: "∠", triangle: "△", square: "□",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", mapsto: "↦",
  implies: "⟹", iff: "⟺", uparrow: "↑", downarrow: "↓",
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭",
  oint: "∮", surd: "√", degree: "°", circ: "∘", bullet: "•",
  cdots: "⋯", ldots: "…", dots: "…", vdots: "⋮", ddots: "⋱",
  hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", wp: "℘",
  prime: "′", langle: "⟨", rangle: "⟩", lvert: "|", rvert: "|", vert: "|",
  lVert: "‖", rVert: "‖", Vert: "‖", lbrace: "{", rbrace: "}",
  quad: "\u2003", qquad: "\u2003\u2003", thinspace: "\u2009",
  // 函数名与算子保持正体
  log: "log", ln: "ln", lg: "lg", exp: "exp", lim: "lim",
  sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc",
  arcsin: "arcsin", arccos: "arccos", arctan: "arctan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh",
  max: "max", min: "min", sup: "sup", inf: "inf", arg: "arg",
  det: "det", dim: "dim", ker: "ker", deg: "deg", gcd: "gcd",
  ...GREEK,
};

// \mathbb{X}：常见的双线体
const BLACKBOARD = {
  R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", E: "𝔼", H: "ℍ", P: "ℙ",
};

// \mathcal{X}：常见的花体
const SCRIPT = { L: "ℒ", F: "ℱ", H: "ℋ", B: "ℬ", P: "𝒫" };

// 重音命令 → 组合字符（追加在基字符之后）
const ACCENTS = {
  hat: "\u0302", widehat: "\u0302", bar: "\u0304", overline: "\u0304",
  vec: "\u20D7", dot: "\u0307", ddot: "\u0308", tilde: "\u0303",
  widetilde: "\u0303",
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 还原 markdown.js 里先行的 HTML 转义，交给本模块按 LaTeX 语义重新处理
function unescapeHtml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function normalizeLatex(s) {
  // JSON/模型输出偶尔会把命令二次转义成 `\\text`。只有双反斜杠紧贴
  // 命令名或转义百分号时才还原；真正的 `\\` 换行后通常是空格或换行。
  return unescapeHtml(s).replace(/\\\\(?=[a-zA-Z%])/g, "\\");
}

function convert(src) {
  let out = "";
  let i = 0;

  // 读一个 {...} 组，返回内部原始串（容忍未闭合的结尾）
  function readGroup() {
    if (src[i] !== "{") return null;
    let depth = 0;
    const start = ++i;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) {
          const inner = src.slice(start, i);
          i++;
          return inner;
        }
        depth--;
      }
      i++;
    }
    return src.slice(start);
  }

  // 读一个参数：优先 {...} 组，否则取单字符（如 \frac12）
  function readArg() {
    if (src[i] === "{") return readGroup();
    if (i < src.length && src[i] === "\\") {
      const start = i;
      i++;
      let name = "";
      while (i < src.length && /[a-zA-Z]/.test(src[i])) name += src[i++];
      if (!name) i++;
      return src.slice(start, i);
    }
    if (i < src.length) return src[i++];
    return "";
  }

  // 解析下一个原子（组 / 命令 / 字母串 / 单字符）为 HTML
  function atomHtml() {
    if (i >= src.length) return "";
    if (src[i] === "{") return convert(readGroup());
    if (src[i] === "\\") return commandHtml();
    if (src[i] === "^" || src[i] === "_") {
      // 连续上下标（x_i^2）交给主循环处理，这里视为空基元防止死循环
      return "";
    }
    const c = src[i++];
    if (/[a-zA-Z]/.test(c)) {
      let run = c;
      while (i < src.length && /[a-zA-Z]/.test(src[i])) run += src[i++];
      return `<i>${run}</i>`;
    }
    if (c === "~") return "&nbsp;";
    return escapeHtml(c);
  }

  function commandHtml() {
    i++; // 跳过反斜杠
    if (i >= src.length) return "";
    const c = src[i];
    if (!/[a-zA-Z]/.test(c)) {
      // 符号命令：\{ \} \\ \, \; \: \! \[ \] 等
      i++;
      if (c === "\\") return "<br>";
      if (c === "," || c === ":" || c === ";" || c === "!") return "&#8202;";
      if (c === " ") return " ";
      return escapeHtml(c);
    }
    let name = "";
    while (i < src.length && /[a-zA-Z]/.test(src[i])) name += src[i++];

    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const num = readArg();
      const den = readArg();
      return `<span class="frac"><span class="fn">${convert(num)}</span><span class="fd">${convert(den)}</span></span>`;
    }
    if (name === "sqrt") {
      const g = readArg();
      return `<span class="sqrt">√<span class="rad">${convert(g)}</span></span>`;
    }
    if (name === "text" || name === "mathrm" || name === "operatorname" || name === "mbox") {
      return escapeHtml(readArg().replace(/\s+/g, " "));
    }
    if (name === "mathbf" || name === "bm" || name === "boldsymbol") {
      return `<b>${convert(readArg())}</b>`;
    }
    if (name === "mathit" || name === "italic") {
      return `<i>${convert(readArg())}</i>`;
    }
    if (name === "mathbb") {
      return readArg()
        .split("")
        .map((ch) => BLACKBOARD[ch] ?? `<b>${escapeHtml(ch)}</b>`)
        .join("");
    }
    if (name === "mathcal") {
      return readArg()
        .split("")
        .map((ch) => SCRIPT[ch] ?? `<i>${escapeHtml(ch)}</i>`)
        .join("");
    }
    if (ACCENTS[name]) {
      const raw = readArg();
      const mark = ACCENTS[name];
      // 组合重音必须与基字符同处一个文本节点才能正确叠放；单字母是最常见的形态
      if (/^[a-zA-Z]$/.test(raw)) return `<i>${raw}${mark}</i>`;
      const base = convert(raw);
      return /<[a-z]/i.test(base) ? base : base + mark;
    }
    if (name === "left" || name === "right" || /^(big|Big|bigl|bigr|Bigl|Bigr|bigm|Bigm)$/.test(name)) {
      return atomHtml(); // 只保留紧随其后的定界符本身
    }
    if (name === "begin" || name === "end") {
      readArg(); // 矩阵等环境的壳，内容按普通符号流渲染
      return "";
    }
    if (SYMBOLS[name] !== undefined) return SYMBOLS[name];
    // 未知命令：去掉反斜杠保留可读性，不报错不吞内容
    return `<i>${escapeHtml(name)}</i>`;
  }

  while (i < src.length) {
    const c = src[i];
    if (c === "^" || c === "_") {
      i++;
      const atom = atomHtml();
      out += c === "^" ? `<sup>${atom}</sup>` : `<sub>${atom}</sub>`;
      continue;
    }
    if (c === "\\") {
      out += commandHtml();
      continue;
    }
    if (c === "{") {
      out += convert(readGroup());
      continue;
    }
    if (c === "}") {
      i++; // 孤立的右括号，忽略
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      out += atomHtml();
      continue;
    }
    if (c === "~") {
      i++;
      out += "&nbsp;";
      continue;
    }
    if (c === "&") {
      i++;
      out += "&#8202;"; // 矩阵对齐符退化为细空格
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      out += " ";
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

export function renderInlineMath(latex) {
  return `<span class="math">${convert(normalizeLatex(latex))}</span>`;
}

export function renderDisplayMath(latex) {
  return `<div class="math math-block">${convert(normalizeLatex(latex))}</div>`;
}
