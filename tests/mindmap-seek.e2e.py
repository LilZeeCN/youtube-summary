from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]

CHROME_MOCK = r"""
window.__seekCalls = [];
const mindmapKey = 'cache:preview:mindmap';
window.chrome = {
  storage: { local: {
    get: async (key) => key === mindmapKey ? {[mindmapKey]: {
      videoId: 'preview', kind: 'mindmap', ts: 1,
      data: {label: '视频主题', t: 0, children: [{label: '关键节点', t: 42, children: []}]}
    }} : {},
    set: async () => {}, remove: async () => {}
  }},
  tabs: {
    query: async () => [{id: 1, active: true, url: 'https://www.youtube.com/watch?v=preview'}],
    sendMessage: async (_id, message) => {
      if (message.type === 'GET_INFO') return {ok: true, info: {
        videoId: 'preview', title: '思维导图跳转测试', pageType: 'watch',
        tracks: [{name: '中文'}], lengthSeconds: 120, description: ''
      }};
      if (message.type === 'SEEK') {
        window.__seekCalls.push(message.payload.time);
        return {ok: true};
      }
      return {ok: true};
    },
    onActivated: {addListener: () => {}},
    onUpdated: {addListener: () => {}}
  },
  runtime: {onMessage: {addListener: () => {}}},
  scripting: {executeScript: async () => {}}
};
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


server = ThreadingHTTPServer(
    ("127.0.0.1", 0),
    lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs),
)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 430, "height": 800})
        page.add_init_script(CHROME_MOCK)
        page.goto(f"http://127.0.0.1:{server.server_port}/sidepanel/sidepanel.html")
        page.wait_for_load_state("networkidle")
        page.locator('[data-tab="map"]').click()
        node = page.locator("#map-svg .mm-node").filter(has_text="关键节点")
        node.locator("rect").click()
        before_drag = page.locator("#map-svg .mm-viewport").get_attribute("transform")
        box = node.locator("rect").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 30, box["y"] + box["height"] / 2 + 20)
        page.mouse.up()
        after_drag = page.locator("#map-svg .mm-viewport").get_attribute("transform")
        calls = page.evaluate("window.__seekCalls")
        browser.close()
        assert calls == [42], f"点击 42 秒节点后没有发送正确的 SEEK 请求：{calls}"
        assert after_drag != before_drag, "延迟指针捕获后，导图拖拽不应失效"
finally:
    server.shutdown()
    server.server_close()
