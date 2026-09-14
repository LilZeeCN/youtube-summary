from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]

CHROME_MOCK = r"""
window.chrome = {
  storage: {local: {get: async () => ({}), set: async () => {}, remove: async () => {}}},
  tabs: {
    query: async () => [{id: 1, active: true, url: 'https://www.youtube.com/watch?v=preview'}],
    sendMessage: async (_id, message) => message.type === 'GET_INFO'
      ? {ok: true, info: {videoId: 'preview', title: '关系标签碰撞测试', pageType: 'watch', tracks: [{name: '中文'}], lengthSeconds: 600}}
      : {ok: true},
    onActivated: {addListener: () => {}}, onUpdated: {addListener: () => {}}
  },
  runtime: {onMessage: {addListener: () => {}}},
  scripting: {executeScript: async () => {}}
};
"""

GRAPH = {
    "title": "普通人投资理财资产筛选与决策流程",
    "nodes": [
        {"id": "principle", "label": "商业第一性原理与认知边界"},
        {"id": "split", "label": "资产属性定性分流"},
        {"id": "core", "label": "核心生息底仓：美股宽基指数"},
        {"id": "safe", "label": "无风险防御：中美高信用国债"},
        {"id": "cash", "label": "商业实体：现金流量化筛选"},
        {"id": "avoid", "label": "规避泡沫：商品房与黑箱A股"},
        {"id": "hedge", "label": "规避投机：外汇期货与加密盘"},
        {"id": "review", "label": "每月复盘并定投长期复制"},
    ],
    "edges": [
        {"from": "principle", "to": "split", "label": "指导分类"},
        {"from": "split", "to": "core", "label": "筛选高成长核心占比"},
        {"from": "split", "to": "safe", "label": "筛选无风险安全垫"},
        {"from": "split", "to": "cash", "label": "严格测算回本周期"},
        {"from": "core", "to": "avoid", "label": "剔除高波动与估值泡沫"},
        {"from": "safe", "to": "avoid", "label": "剔除信息不透明资产"},
        {"from": "safe", "to": "hedge", "label": "博弈风险压力测试"},
        {"from": "cash", "to": "hedge", "label": "验证现金流可持续性"},
        {"from": "avoid", "to": "review", "label": "纪律执行"},
        {"from": "hedge", "to": "review", "label": "周期复盘"},
    ],
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


server = ThreadingHTTPServer(
    ("127.0.0.1", 0),
    lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs),
)
Thread(target=server.serve_forever, daemon=True).start()

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 430, "height": 920})
        page.add_init_script(CHROME_MOCK)
        page.goto(f"http://127.0.0.1:{server.server_port}/sidepanel/sidepanel.html")
        page.wait_for_load_state("networkidle")
        page.evaluate("""async (graph) => {
          const {renderMarkdown} = await import('/sidepanel/modules/markdown.js');
          const root = document.querySelector('#sum-md');
          document.querySelector('#sum-placeholder').classList.add('hidden');
          root.classList.remove('hidden');
          const newline = String.fromCharCode(10);
          root.innerHTML = renderMarkdown(['```relation', JSON.stringify(graph), '```'].join(newline));
        }""", GRAPH)
        page.wait_for_timeout(400)
        collisions = page.evaluate("""() => {
          const boxes = (selector) => [...document.querySelectorAll(selector)].map((element) => {
            const box = element.getBoundingClientRect();
            return {text: element.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom};
          });
          const labels = boxes('.relation-edge-label');
          const nodes = boxes('.relation-node rect');
          const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const result = [];
          labels.forEach((label, index) => {
            labels.slice(index + 1).forEach((other) => {
              if (overlaps(label, other)) result.push(`标签“${label.text}”挡住“${other.text}”`);
            });
            nodes.forEach((node) => {
              if (overlaps(label, node)) result.push(`标签“${label.text}”压到节点`);
            });
          });
          return result;
        }""")
        browser.close()
        assert not collisions, "；".join(collisions)
finally:
    server.shutdown()
    server.server_close()
