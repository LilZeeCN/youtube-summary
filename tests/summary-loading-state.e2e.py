from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]

CHROME_MOCK = r"""
window.__onUpdated = () => {};
const settings = {activeProfileId: 'profile-1', autoSummarize: false};
const profiles = [{
  id: 'profile-1', name: '测试模型', provider: 'openai',
  apiUrl: 'http://127.0.0.1:9999/v1', apiKey: '', model: 'test-model'
}];
window.chrome = {
  storage: { local: {
    get: async (key) => {
      if (Array.isArray(key)) return {settings, modelProfiles: profiles};
      if (key === 'settings') return {settings};
      return {};
    },
    set: async () => {}, remove: async () => {}
  }},
  tabs: {
    query: async () => [{id: 1, active: true, url: 'https://www.youtube.com/watch?v=preview'}],
    sendMessage: async (_id, message) => {
      if (message.type === 'GET_INFO') return {ok: true, info: {
        videoId: 'preview', title: '总结加载状态测试', pageType: 'watch',
        tracks: [{name: '中文'}], lengthSeconds: 120, description: ''
      }};
      if (message.type === 'GET_SUBTITLES') {
        return await new Promise((resolve) => setTimeout(() => resolve({
          ok: true, cues: [{start: 0, text: '测试字幕'}], track: {name: '中文'}
        }), 5000));
      }
      return {ok: true};
    },
    onActivated: {addListener: () => {}},
    onUpdated: {addListener: (callback) => { window.__onUpdated = callback; }}
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
        page.locator("#btn-summarize").click()
        page.evaluate("window.__onUpdated(1, {status: 'complete'}, {active: true})")
        page.wait_for_timeout(350)
        stage_visible = page.locator("#sum-stage").is_visible()
        placeholder_visible = page.locator("#sum-placeholder").is_visible()
        browser.close()
        assert stage_visible, "总结过程中应持续显示处理状态"
        assert not placeholder_visible, "总结开始后不应再次显示‘快速掌握这个视频’初始模块"
finally:
    server.shutdown()
    server.server_close()
