import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../sidepanel/modules/markdown.js";

test("relation 围栏会渲染为真实的节点与连线图", () => {
  const markdown = `## 概念与流程关系

\`\`\`relation
{
  "title": "资产筛选逻辑",
  "nodes": [
    {"id":"baseline","label":"底层基准与哲学"},
    {"id":"screen","label":"资产筛选"},
    {"id":"growth","label":"成长底仓"},
    {"id":"defense","label":"防御配置"}
  ],
  "edges": [
    {"from":"baseline","to":"screen","label":"建立标准"},
    {"from":"screen","to":"growth","label":"高成长"},
    {"from":"screen","to":"defense","label":"低波动"}
  ]
}
\`\`\``;

  const html = renderMarkdown(markdown);

  assert.match(html, /<figure class="relation-diagram"/);
  assert.match(html, /<svg[^>]+aria-label="资产筛选逻辑"/);
  assert.match(html, />底层基准与哲学</);
  assert.match(html, />防御配置</);
  assert.match(html, /class="relation-edge"/);
  assert.doesNotMatch(html, /&quot;nodes&quot;/);
});

test("关系图节点不显示无信息意义的装饰圆点", () => {
  const html = renderMarkdown(`\`\`\`relation
${JSON.stringify({
  title: "简洁节点",
  nodes: [
    { id: "start", label: "起点" },
    { id: "result", label: "结果" },
  ],
  edges: [{ from: "start", to: "result" }],
})}
\`\`\``);

  assert.match(html, /class="relation-node /);
  assert.doesNotMatch(html, /<circle class="relation-node-mark"/);
});

test("较多并列分支会自动换行，不让节点在窄侧栏中互相覆盖", () => {
  const branches = Array.from({ length: 5 }, (_, index) => ({
    id: `result-${index}`,
    label: `结果 ${index + 1}`,
  }));
  const html = renderMarkdown(`\`\`\`relation
${JSON.stringify({
  title: "多分支关系",
  nodes: [{ id: "root", label: "决策入口" }, ...branches],
  edges: branches.map((node) => ({ from: "root", to: node.id })),
})}
\`\`\``);
  const positions = Array.from(
    html.matchAll(/relation-node relation-node-outcome" transform="translate\(([-\d.]+),([-\d.]+)\)/g),
    (match) => ({ x: Number(match[1]), y: Number(match[2]) })
  );

  assert.equal(positions.length, 5);
  for (let left = 0; left < positions.length; left++) {
    for (let right = left + 1; right < positions.length; right++) {
      const sameRow = Math.abs(positions[left].y - positions[right].y) < 58;
      assert.ok(!sameRow || Math.abs(positions[left].x - positions[right].x) >= 168);
    }
  }
});

test("流式输出尚未闭合 relation 围栏时不暴露半截 JSON", () => {
  const html = renderMarkdown('```relation\n{"title":"正在生成","nodes":[');

  assert.match(html, /relation-diagram-loading/);
  assert.doesNotMatch(html, /<pre><code>/);
  assert.doesNotMatch(html, /&quot;nodes&quot;/);
});
