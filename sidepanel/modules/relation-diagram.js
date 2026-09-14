const MAX_NODES = 12;
const MAX_EDGES = 18;
const CANVAS_W = 600;
const NODE_W = 168;
const NODE_H = 58;
const LEVEL_GAP = 88;

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function textUnits(value) {
  return Array.from(String(value || "")).reduce(
    (total, char) => total + (/[\u2E80-\u9FFF\uF900-\uFAFF]/.test(char) ? 1 : 0.55),
    0
  );
}

function compactEdgeLabel(value) {
  const label = cleanText(value, 48);
  if (textUnits(label) <= 7) return label;
  const chars = [];
  let units = 0;
  for (const char of Array.from(label)) {
    const next = /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(char) ? 1 : 0.55;
    if (units + next > 6) break;
    chars.push(char);
    units += next;
  }
  return `${chars.join("")}…`;
}

function parseRelation(raw) {
  let value;
  try {
    value = JSON.parse(String(raw || "").trim());
  } catch {
    return null;
  }
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;

  const seen = new Set();
  const nodes = value.nodes
    .slice(0, MAX_NODES)
    .map((node) => ({ id: cleanText(node?.id, 32), label: cleanText(node?.label, 40) }))
    .filter((node) => node.id && node.label && !seen.has(node.id) && seen.add(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = value.edges
    .slice(0, MAX_EDGES)
    .map((edge) => {
      const fullLabel = cleanText(edge?.label, 48);
      return {
        from: cleanText(edge?.from, 32),
        to: cleanText(edge?.to, 32),
        label: compactEdgeLabel(fullLabel),
        fullLabel,
      };
    })
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);

  if (nodes.length < 2 || !edges.length) return null;
  return { title: cleanText(value.title, 50) || "概念与流程关系", nodes, edges };
}

function layoutGraph(graph) {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  graph.edges.forEach((edge) => {
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  });

  const levels = new Map(graph.nodes.map((node) => [node.id, 0]));
  const queue = graph.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const remainingIncoming = new Map(incoming);
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of outgoing.get(id)) {
      levels.set(next, Math.max(levels.get(next), levels.get(id) + 1));
      remainingIncoming.set(next, remainingIncoming.get(next) - 1);
      if (remainingIncoming.get(next) === 0) queue.push(next);
    }
  }
  // 循环关系无法拓扑排序时放到末层，仍保证图可读且不死循环。
  const lastResolvedLevel = Math.max(0, ...Array.from(levels.values()));
  graph.nodes.forEach((node) => {
    if (!visited.has(node.id)) levels.set(node.id, lastResolvedLevel + 1);
  });

  const logicalRows = [];
  graph.nodes.forEach((node) => {
    const level = levels.get(node.id);
    if (!logicalRows[level]) logicalRows[level] = [];
    logicalRows[level].push(node);
  });
  const rows = [];
  logicalRows.forEach((row) => {
    for (let index = 0; index < row.length; index += 3) rows.push(row.slice(index, index + 3));
  });

  const positioned = new Map();
  rows.forEach((row, level) => {
    const gap = row.length > 1 ? Math.min(24, (CANVAS_W - 36 - row.length * NODE_W) / (row.length - 1)) : 0;
    const rowWidth = row.length * NODE_W + Math.max(0, row.length - 1) * gap;
    const startX = (CANVAS_W - rowWidth) / 2;
    row.forEach((node, index) => {
      positioned.set(node.id, {
        ...node,
        x: startX + index * (NODE_W + gap),
        y: 32 + level * (NODE_H + LEVEL_GAP),
        kind:
          incoming.get(node.id) === 0
            ? "source"
            : outgoing.get(node.id).length > 1
              ? "decision"
              : outgoing.get(node.id).length === 0
                ? "outcome"
                : "step",
      });
    });
  });
  const laidOutEdges = graph.edges.map((edge) => {
    const sameSource = graph.edges.filter((candidate) => candidate.from === edge.from);
    const sameTarget = graph.edges.filter((candidate) => candidate.to === edge.to);
    return {
      ...edge,
      fromNode: positioned.get(edge.from),
      toNode: positioned.get(edge.to),
      sourceIndex: sameSource.indexOf(edge),
      sourceCount: sameSource.length,
      targetIndex: sameTarget.indexOf(edge),
      targetCount: sameTarget.length,
    };
  });
  return {
    nodes: Array.from(positioned.values()),
    edges: placeEdgeLabels(laidOutEdges, Array.from(positioned.values())),
    height: Math.max(180, 124 + Math.max(0, rows.length - 1) * (NODE_H + LEVEL_GAP)),
  };
}

function boxesOverlap(a, b, padding = 5) {
  return (
    a.left < b.right + padding &&
    a.right > b.left - padding &&
    a.top < b.bottom + padding &&
    a.bottom > b.top - padding
  );
}

function placeEdgeLabels(edges, nodes) {
  const occupied = [];
  const nodeBoxes = nodes.map((node) => ({
    left: node.x,
    right: node.x + NODE_W,
    top: node.y,
    bottom: node.y + NODE_H,
  }));

  return edges.map((edge) => {
    if (!edge.label) return { ...edge, showLabel: false };
    const fromX = edge.fromNode.x + NODE_W / 2;
    const fromY = edge.fromNode.y + NODE_H;
    const toX = edge.toNode.x + NODE_W / 2;
    const toY = edge.toNode.y;
    const labelWidth = Math.min(104, Math.max(38, textUnits(edge.label) * 12 + 16));
    const labelHeight = 20;
    const preferred =
      (edge.sourceIndex - (edge.sourceCount - 1) / 2) * 22 +
      (edge.targetIndex - (edge.targetCount - 1) / 2) * 10;
    const offsets = [...new Set([preferred, 0, preferred - 22, preferred + 22, -33, 33])];
    let placement = null;

    for (const offset of offsets) {
      const x = (fromX + toX) / 2;
      const y = (fromY + toY) / 2 + offset;
      const box = {
        left: x - labelWidth / 2,
        right: x + labelWidth / 2,
        top: y - labelHeight / 2,
        bottom: y + labelHeight / 2,
      };
      const hitsLabel = occupied.some((other) => boxesOverlap(box, other));
      const hitsNode = nodeBoxes.some((nodeBox) => boxesOverlap(box, nodeBox, 3));
      if (!hitsLabel && !hitsNode) {
        placement = { x, y, box };
        break;
      }
    }

    if (!placement) return { ...edge, showLabel: false, labelWidth };
    occupied.push(placement.box);
    return {
      ...edge,
      showLabel: true,
      labelX: placement.x,
      labelY: placement.y,
      labelWidth,
    };
  });
}

function splitLabel(label) {
  let units = 0;
  let splitAt = -1;
  const chars = Array.from(label);
  for (let index = 0; index < chars.length; index++) {
    units += /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(chars[index]) ? 1 : 0.55;
    if (units >= 11 && index < chars.length - 1) {
      splitAt = index + 1;
      break;
    }
  }
  return splitAt > 0 ? [chars.slice(0, splitAt).join(""), chars.slice(splitAt).join("")] : [label];
}

function renderNode(node) {
  const lines = splitLabel(node.label).slice(0, 2);
  const centerX = node.x + NODE_W / 2;
  const firstY = node.y + (lines.length === 1 ? 34 : 27);
  return `<g class="relation-node relation-node-${node.kind}" transform="translate(${node.x},${node.y})">
    <rect width="${NODE_W}" height="${NODE_H}" rx="10" />
    <text class="relation-node-label" x="${centerX - node.x}" y="${firstY - node.y}" text-anchor="middle">
      ${lines.map((line, index) => `<tspan x="${centerX - node.x}" dy="${index ? 17 : 0}">${escapeXml(line)}</tspan>`).join("")}
    </text>
    <title>${escapeXml(node.label)}</title>
  </g>`;
}

function renderEdge(edge) {
  const fromX = edge.fromNode.x + NODE_W / 2;
  const fromY = edge.fromNode.y + NODE_H;
  const toX = edge.toNode.x + NODE_W / 2;
  const toY = edge.toNode.y;
  const midY = (fromY + toY) / 2;
  const label = edge.showLabel
    ? `<g class="relation-edge-label" transform="translate(${edge.labelX},${edge.labelY})">
        <rect x="${-edge.labelWidth / 2}" y="-10" width="${edge.labelWidth}" height="20" rx="10" />
        <text y="4" text-anchor="middle">${escapeXml(edge.label)}</text>
        ${edge.fullLabel && edge.fullLabel !== edge.label ? `<title>${escapeXml(edge.fullLabel)}</title>` : ""}
      </g>`
    : "";
  return `<path class="relation-edge" d="M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY - 7}" marker-end="url(#relation-arrow)" />${label}`;
}

export function renderRelationDiagram(raw) {
  const graph = parseRelation(raw);
  if (!graph) return "";
  const layout = layoutGraph(graph);
  return `<figure class="relation-diagram">
    <figcaption><span aria-hidden="true"></span>${escapeXml(graph.title)}</figcaption>
    <div class="relation-diagram-canvas">
      <svg viewBox="0 0 ${CANVAS_W} ${layout.height}" role="img" aria-label="${escapeXml(graph.title)}" preserveAspectRatio="xMidYMin meet">
        <defs><marker id="relation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
        <g class="relation-edges">${layout.edges.map(renderEdge).join("")}</g>
        <g class="relation-nodes">${layout.nodes.map(renderNode).join("")}</g>
      </svg>
    </div>
  </figure>`;
}
