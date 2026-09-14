import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../sidepanel/modules/markdown.js";
import { renderInlineMath } from "../sidepanel/modules/math.js";

test("renders inline greek letters from $...$", () => {
  const html = renderMarkdown("缩放（$\\gamma$）与偏置（$\\beta$）参数");
  assert.equal(html, "<p>缩放（<span class=\"math\">γ</span>）与偏置（<span class=\"math\">β</span>）参数</p>");
});

test("renders superscripts, subscripts and fractions", () => {
  const html = renderMarkdown("损失 $L = \\theta_0 x^2 + \\frac{1}{2}$ 最小");
  assert.match(html, /<i>L<\/i> = θ<sub>0<\/sub>/);
  assert.match(html, /<sup>2<\/sup>/);
  assert.match(html, /<span class="frac"><span class="fn">1<\/span><span class="fd">2<\/span><\/span>/);
});

test("renders single-line and fenced display math blocks", () => {
  assert.match(
    renderMarkdown("$$E = mc^2$$"),
    /<div class="math math-block"><i>E<\/i> = <i>mc<\/i><sup>2<\/sup><\/div>/
  );
  const html = renderMarkdown("前文\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n后文");
  assert.match(html, /<div class="math math-block">/);
  assert.match(html, /∑/);
  assert.match(html, /<sub><i>i<\/i>=1<\/sub>/);
  assert.match(html, /<p>前文<\/p>/);
  assert.match(html, /<p>后文<\/p>/);
});

test("renders Chinese text and comparison operators inside a multiline display formula", () => {
  const html = renderMarkdown(`执行硬性初筛：

$$
\\text{年租金回报率} =
\\frac{\\text{年租金收入}}{\\text{总买入成本}}
\\times 100\\%
\\ge 10\\%
$$`);

  assert.match(html, /<div class="math math-block">/);
  assert.match(html, /年租金回报率/);
  assert.match(html, /<span class="frac">/);
  assert.match(html, /× 100%/);
  assert.match(html, /≥ 10%/);
  assert.doesNotMatch(html, /<i>(?:text|frac|times|ge)<\/i>/);
});

test("repairs double-escaped commands in a multiline display formula", () => {
  const html = renderMarkdown(`执行硬性初筛：

$$
\\\\text{年租金回报率} =
\\\\frac{
\\\\text{年租金收入}
}{
\\\\text{总买入成本}
}
\\\\times 100
\\\\%
\\\\ge 10
\\\\%。
$$`);

  assert.match(html, /年租金回报率/);
  assert.match(html, /<span class="frac">/);
  assert.match(html, /× 100/);
  assert.match(html, /≥ 10/);
  assert.doesNotMatch(html, /<br><i>(?:text|frac|times|ge)<\/i>/);
});

test("does not treat plain dollar amounts as math", () => {
  const html = renderMarkdown("这台设备 $100 和 $200 买不到");
  assert.ok(!html.includes('class="math"'));
});

test("escapes unsafe characters inside math", () => {
  const html = renderMarkdown("当 $a < b$ 时成立");
  assert.match(html, /<span class="math"><i>a<\/i> &lt; <i>b<\/i><\/span>/);
});

test("keeps unknown commands readable instead of dropping them", () => {
  const html = renderInlineMath("\\foobar + x");
  assert.match(html, /<i>foobar<\/i>/);
});

test("combining accents attach to the base symbol", () => {
  const html = renderMarkdown("参数估计 $\\hat{\\theta}$ 与 $\\hat{x}$");
  assert.equal(
    html,
    '<p>参数估计 <span class="math">θ\u0302</span> 与 <span class="math"><i>x\u0302</i></span></p>'
  );
});

test("math coexists with bold text and clickable timestamps", () => {
  const html = renderMarkdown("**梯度下降** 在 [03:24] 处讲解，更新式 $w \\leftarrow w - \\eta g$");
  assert.match(html, /<strong>梯度下降<\/strong>/);
  assert.match(html, /<button class="ts" data-t="204"/);
  assert.match(html, /←/);
});

test("code spans take precedence over math", () => {
  const html = renderMarkdown("命令 `$x^2$` 原样显示");
  assert.match(html, /<code>\$x\^2\$<\/code>/);
  assert.ok(!html.includes('class="math"'));
});
