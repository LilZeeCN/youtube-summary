// 轻量思维导图渲染器：纯 SVG 水平树布局（无第三方库，MV3 扩展页 CSP 安全）。
// 支持：节点折叠/展开、双指滑动/拖拽平移、捏合缩放、时间戳节点点击跳转、适应画布。

const ROW = 58; // 每个叶子节点占据的行高
const NODE_H = 36;
const TS_NODE_H = 50;
const PAD_X = 14;
const HGAP = 60; // 列间距（放连线）
const MAX_LABEL_W = 190;

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseMindmapJson(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("输出中未找到 JSON 结构");
  let data;
  try {
    data = JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw new Error("JSON 解析失败，请重新生成");
  }
  return sanitize(data);
}

function sanitize(node) {
  if (!node || typeof node.label !== "string" || !node.label.trim()) return null;
  const out = {
    label: node.label.trim().slice(0, 40),
    t: Number.isFinite(Number(node.t)) && Number(node.t) >= 0 ? Math.round(Number(node.t)) : null,
    collapsed: false,
  };
  if (Array.isArray(node.children)) {
    const kids = node.children.map(sanitize).filter(Boolean).slice(0, 10);
    if (kids.length) out.children = kids;
  }
  return out;
}

export class MindMap {
  constructor(svg, { onSeek } = {}) {
    this.svg = svg;
    this.onSeek = onSeek || (() => {});
    this.k = 1;
    this.tx = 40;
    this.ty = 40;
    this.root = null;
    this._dragged = false;
    this._bind();
  }

  setData(root) {
    this.root = root;
    this._layout();
    this._render();
    this.fit();
  }

  expandAll() {
    this._each(this.root, (n) => (n.collapsed = false));
    this.setData(this.root);
  }

  collapseAll() {
    this._each(this.root, (n, depth) => {
      if (depth >= 1 && n.children) n.collapsed = true;
    });
    this.setData(this.root);
  }

  fit() {
    if (!this.root || !this.contentW) return;
    const w = this.svg.clientWidth || 320;
    const h = this.svg.clientHeight || 400;
    const k = Math.min((w - 24) / this.contentW, (h - 24) / this.contentH, 1);
    this.k = Math.max(k, 0.08);
    this.tx = (w - this.contentW * this.k) / 2;
    this.ty = (h - this.contentH * this.k) / 2;
    this._applyTransform();
  }

  zoomBy(factor, cx, cy) {
    const w = this.svg.clientWidth || 320;
    const h = this.svg.clientHeight || 400;
    const mx = cx == null ? w / 2 : cx;
    const my = cy == null ? h / 2 : cy;
    const k2 = Math.min(Math.max(this.k * factor, 0.08), 2.5);
    this.tx = mx - (mx - this.tx) * (k2 / this.k);
    this.ty = my - (my - this.ty) * (k2 / this.k);
    this.k = k2;
    this._applyTransform();
  }

  _each(node, fn, depth = 0) {
    if (!node) return;
    fn(node, depth);
    (node.children || []).forEach((c) => this._each(c, fn, depth + 1));
  }

  _measure(label) {
    // 优先用真实渲染测量（容器可见时），否则按字符宽度估算
    let probe = this._probe;
    if (!probe) {
      probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
      probe.setAttribute("class", "mm-label");
      probe.style.visibility = "hidden";
      this.svg.appendChild(probe);
      this._probe = probe;
    }
    probe.textContent = label;
    let w = 0;
    try {
      w = probe.getComputedTextLength();
    } catch (e) {}
    if (!w) {
      for (const ch of label) {
        w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 14 : 7.6;
      }
    }
    return Math.ceil(w);
  }

  _layout() {
    const colW = [];

    const visit = (node, depth) => {
      node._d = depth;
      let textW = Math.min(this._measure(node.label), MAX_LABEL_W);
      node._trunc = textW < this._measure(node.label);
      node._w = textW + PAD_X * 2 + (node.t != null ? 46 : 0);
      node._h = node.t != null ? TS_NODE_H : NODE_H;
      colW[depth] = Math.max(colW[depth] || 0, node._w);
      (node.children || []).forEach((c) => visit(c, depth + 1));
    };
    visit(this.root, 0);

    const xs = [0];
    for (let d = 1; d < colW.length; d++) xs[d] = xs[d - 1] + colW[d - 1] + HGAP;
    this.xs = xs;
    this.contentW = xs[colW.length - 1] + colW[colW.length - 1];

    const subtreeH = (node) => {
      if (node.collapsed || !node.children) return (node._sh = ROW);
      return (node._sh = node.children.reduce((s, c) => s + subtreeH(c), 0));
    };
    subtreeH(this.root);
    this.contentH = this.root._sh;

    const place = (node, top) => {
      node._y = top + node._sh / 2;
      node._x = xs[node._d];
      let childTop = top;
      (node.children || []).forEach((c) => {
        place(c, childTop);
        childTop += c._sh;
      });
    };
    place(this.root, 0);
  }

  _render() {
    const NS = "http://www.w3.org/2000/svg";
    let vp = this.svg.querySelector(".mm-viewport");
    if (!vp) {
      const defs = document.createElementNS(NS, "defs");
      defs.innerHTML = `
        <linearGradient id="mmGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff4d6d"/><stop offset="1" stop-color="#b14dff"/>
        </linearGradient>`;
      this.svg.appendChild(defs);
      vp = document.createElementNS(NS, "g");
      vp.setAttribute("class", "mm-viewport");
      this.svg.appendChild(vp);
    }
    vp.innerHTML = "";
    this._rendered = [];
    const rendered = this._rendered;

    const edges = document.createElementNS(NS, "g");
    edges.setAttribute("class", "mm-edges");
    const nodes = document.createElementNS(NS, "g");
    nodes.setAttribute("class", "mm-nodes");
    vp.appendChild(edges);
    vp.appendChild(nodes);

    const walk = (node) => {
      rendered.push(node);
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", `mm-node d${Math.min(node._d, 3)}${node.t != null ? " has-t" : ""}`);
      g.setAttribute("transform", `translate(${node._x},${node._y - node._h / 2})`);
      g.dataset.idx = rendered.length - 1;

      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("width", node._w);
      rect.setAttribute("height", node._h);
      rect.setAttribute("rx", 10);
      g.appendChild(rect);

      const label = document.createElementNS(NS, "text");
      label.setAttribute("class", "mm-label");
      label.setAttribute("x", PAD_X);
      label.setAttribute("y", node.t != null ? 21 : 24);
      label.textContent = node.label;
      g.appendChild(label);

      if (node.t != null) {
        const time = document.createElementNS(NS, "text");
        time.setAttribute("class", "mm-time");
        time.setAttribute("x", PAD_X);
        time.setAttribute("y", 38);
        time.textContent = `▶ ${fmt(node.t)}`;
        g.appendChild(time);
      }

      if (node.children && node.children.length) {
        const tg = document.createElementNS(NS, "g");
        tg.setAttribute("class", `mm-toggle${node.collapsed ? " closed" : ""}`);
        tg.setAttribute("transform", `translate(${node._w + 7},${node._h / 2})`);
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("r", 9);
        const tn = document.createElementNS(NS, "text");
        tn.setAttribute("class", "mm-toggle-n");
        tn.textContent = node.collapsed ? String(node.children.length) : "–";
        tg.appendChild(c);
        tg.appendChild(tn);
        g.appendChild(tg);

        if (!node.collapsed) {
          for (const child of node.children) {
            const p = document.createElementNS(NS, "path");
            const x1 = node._x + node._w + 16;
            const y1 = node._y;
            const x2 = child._x;
            const y2 = child._y;
            const mid = (x1 + x2) / 2;
            p.setAttribute(
              "d",
              `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
            );
            edges.appendChild(p);
          }
        }
      }
      nodes.appendChild(g);
      if (!node.collapsed) (node.children || []).forEach(walk);
    };
    walk(this.root);
    this._applyTransform();
  }

  _applyTransform() {
    const vp = this.svg.querySelector(".mm-viewport");
    if (vp) vp.setAttribute("transform", `translate(${this.tx},${this.ty}) scale(${this.k})`);
  }

  _bind() {
    let down = null;
    this.svg.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      this._dragged = false;
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4 && !this._dragged) {
        this._dragged = true;
        this.svg.setPointerCapture(e.pointerId);
      }
      if (this._dragged) {
        this.tx = down.tx + dx;
        this.ty = down.ty + dy;
        this._applyTransform();
      }
    });
    this.svg.addEventListener("pointerup", () => {
      down = null;
    });

    this.svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          // macOS 触控板捏合会产生 ctrlKey=true 的 wheel 事件。
          const r = this.svg.getBoundingClientRect();
          const factor = Math.exp(-e.deltaY * 0.01);
          this.zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
          return;
        }

        // 普通双指滑动只平移画布，不再触发缩放。
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.svg.clientHeight : 1;
        this.tx -= e.deltaX * unit;
        this.ty -= e.deltaY * unit;
        this._applyTransform();
      },
      { passive: false }
    );

    this.svg.addEventListener("click", (e) => {
      if (this._dragged) return;
      const nodeG = e.target.closest(".mm-node");
      if (!nodeG) return;
      const node = this._rendered[+nodeG.dataset.idx];
      if (!node) return;
      const toggle = e.target.closest(".mm-toggle");
      if (toggle) {
        node.collapsed = !node.collapsed;
        this._layout();
        this._render();
      } else if (node.t != null) {
        this.onSeek(node.t);
      } else if (node.children) {
        node.collapsed = !node.collapsed;
        this._layout();
        this._render();
      }
    });
  }
}
