# 临时视觉验证脚本：亮色/暗色主题截图（不在测试套件中，人工检查用）
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path("/tmp/theme-shots")
OUT.mkdir(exist_ok=True)

CHROME_MOCK = r"""
const settings = {activeProfileId: 'profile-1', autoSummarize: false, theme: 'THEME_PLACEHOLDER'};
const profiles = [{
  id: 'profile-1', name: 'DeepSeek · 测试', provider: 'openai',
  apiUrl: 'http://127.0.0.1:9999/v1', apiKey: '', model: 'deepseek-chat'
}];
window.chrome = {
  storage: { local: {
    get: async (key) => {
      if (Array.isArray(key)) return {settings, modelProfiles: profiles};
      if (key === 'settings') return {settings};
      if (key && key.startsWith('cache:')) return {};
      return {modelProfiles: profiles};
    },
    set: async () => {}, remove: async () => {}
  }},
  runtime: { id: 'test', sendMessage: async () => {}, onMessage: {addListener: () => {}} },
  tabs: {
    query: async () => [{id: 1, active: true, url: 'https://www.youtube.com/watch?v=preview'}],
    sendMessage: async (_id, message) => {
      if (message.type === 'GET_INFO') return {ok: true, info: {
        videoId: 'preview', title: '主题预览测试视频', pageType: 'watch',
        tracks: [{name: '中文（自动）', lang: 'zh'}], lengthSeconds: 120, description: ''
      }};
      if (message.type === 'GET_SUBTITLES') return {ok: true, cues: [
        {start: 0, dur: 3, text: '欢迎来到本期视频'},
        {start: 3, dur: 4, text: '今天我们聊聊主题设计'}
      ], track: {name: '中文（自动）', index: 0}};
      if (message.type === 'GET_TIME') return {ok: true, time: 1, paused: false};
      return {ok: true};
    },
    onActivated: {addListener: () => {}},
    onUpdated: {addListener: () => {}},
  }
};
"""

SUMMARY_DOC_HTML = r"""
const md = document.querySelector('#sum-md');
md.classList.remove('hidden');
document.querySelector('#sum-placeholder').classList.add('hidden');
document.querySelector('#sum-actions').classList.remove('hidden');
document.querySelector('#sum-mode-switch').classList.remove('hidden');
md.innerHTML = `
<div class="summary-doc">
  <div class="summary-hero">
    <div class="summary-eyebrow"><span>TL;DR</span><span>01 · 结构化概览</span></div>
    <p class="summary-thesis">这一期讲解如何为浏览器扩展设计双主题系统，重点是变量化与图层隔离。</p>
  </div>
  <div class="summary-section">
    <div class="summary-section-heading"><span>02</span><h3>关键要点</h3></div>
    <div class="summary-point">
      <div class="summary-point-rail"><span class="summary-point-number">P1</span><button class="ts" data-t="12">0:12</button></div>
      <div class="summary-point-body">
        <p>把颜色收敛为 CSS 变量，暗色是默认态，亮色仅做覆盖，避免双份维护。</p>
        <div class="summary-point-tools"><div class="summary-point-actions">
          <button class="summary-evidence-toggle" data-evidence-toggle="p1"><span>查看字幕依据</span><span class="summary-evidence-count">2</span></button>
          <button class="summary-refine" data-summary-refine="p1">优化这一条</button>
        </div></div>
        <div class="summary-evidence" data-evidence="p1">
          <div class="summary-evidence-row"><button class="ts" data-t="12">0:12</button><p>颜色都收敛为变量，方便覆盖</p></div>
        </div>
      </div>
    </div>
  </div>
  <div class="summary-section">
    <div class="summary-section-heading"><span>03</span><h3>章节</h3></div>
    <div class="summary-chapters">
      <div class="summary-chapter"><span class="summary-chapter-marker"></span>
        <div><div class="summary-chapter-title"><button class="ts" data-t="0">0:00</button><h4>为什么需要亮色主题</h4></div>
        <div class="summary-chapter-body"><p>用户反馈夜间刺眼之外，白天暗色同样有不适配的场景。</p></div></div>
      </div>
    </div>
  </div>
</div>`;
"""

CHAT_HTML = r"""
const list = document.querySelector('#chat-list');
list.innerHTML = '';
const user = document.createElement('div'); user.className = 'msg user';
user.innerHTML = '<div class="bubble">精读模式里的关系图在亮色下能看清吗？</div>';
const bot = document.createElement('div'); bot.className = 'msg assistant';
bot.innerHTML = `<div class="bubble md"><p>可以，关系图节点的描边和网格都已按亮色重配：</p>
<ul><li>节点白底 + 深灰描边</li><li>网格线改为深色低透明度</li></ul>
<p>行内代码 <code>oklch(0.54 0.235 310)</code> 与 <button class="ts" data-t="42">0:42</button> 时间戳都保持可读。</p></div>`;
list.append(user, bot);
"""

MINDMAP_HTML = r"""
const wrap = document.querySelector('#map-wrap');
wrap.classList.remove('hidden');
document.querySelector('#map-placeholder').classList.add('hidden');
document.querySelector('#map-actions').classList.remove('hidden');
const svg = document.querySelector('#map-svg');
svg.innerHTML = `<defs><linearGradient id="mmGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset="1" stop-color="#b14dff"/></linearGradient></defs>
<g class="mm-viewport"><g class="mm-edges"><path d="M140 60 L220 60"/></g>
<g class="mm-nodes">
<g class="mm-node d0" transform="translate(20,45)"><rect width="120" height="32" rx="8"/><text class="mm-label" x="60" y="21" text-anchor="middle">视频主题</text></g>
<g class="mm-node d1" transform="translate(200,20)"><rect width="110" height="30" rx="8"/><text class="mm-label" x="55" y="20" text-anchor="middle">变量化</text></g>
<g class="mm-node has-t" transform="translate(200,70)"><rect width="130" height="30" rx="8"/><text class="mm-label" x="65" y="20" text-anchor="middle">图层覆盖</text><text class="mm-time" x="65" y="44" text-anchor="middle">1:02</text></g>
</g></g>`;
"""


class Server(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    server = ThreadingHTTPServer(("127.0.0.1", 8951), Server)
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def shoot(page, name):
    # 等入场动画（fadeUp / visual-enter，最长 0.3s）播完再拍，避免截到半透明帧
    page.wait_for_timeout(450)
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=False)


def run_theme(browser, theme):
    mock = CHROME_MOCK.replace("THEME_PLACEHOLDER", theme)
    page = browser.new_page(viewport={"width": 460, "height": 840})
    page.add_init_script(mock)
    page.goto("http://127.0.0.1:8951/sidepanel/sidepanel.html")
    page.wait_for_timeout(600)

    applied = page.evaluate("document.documentElement.dataset.theme")
    print(f"theme={theme} → data-theme={applied}")

    # 总结页：注入结构化文档
    page.evaluate(SUMMARY_DOC_HTML)
    shoot(page, f"{theme}-1-summary")

    # 对话页
    page.click('[data-tab="chat"]')
    page.evaluate(CHAT_HTML)
    shoot(page, f"{theme}-2-chat")

    # 字幕页
    page.click('[data-tab="subs"]')
    page.wait_for_timeout(800)
    shoot(page, f"{theme}-3-subs")

    # 导图页
    page.click('[data-tab="map"]')
    page.evaluate(MINDMAP_HTML)
    shoot(page, f"{theme}-4-map")

    # 设置页：滚到底部拍「通用」区（含外观下拉框），再滚回顶部拍编辑表单
    page.click('[data-tab="settings"]')
    page.evaluate("document.querySelector('#tab-settings').scrollTop = 9999")
    shoot(page, f"{theme}-5-settings-general")
    page.evaluate("document.querySelector('#tab-settings').scrollTop = 0")
    page.click('#btn-add-profile')
    shoot(page, f"{theme}-6-settings-editor")
    page.close()


server = serve()
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    run_theme(browser, "light")
    run_theme(browser, "dark")
    # 头部按钮切换：dark → light
    page = browser.new_page(viewport={"width": 460, "height": 840})
    page.add_init_script(CHROME_MOCK.replace("THEME_PLACEHOLDER", "dark"))
    page.goto("http://127.0.0.1:8951/sidepanel/sidepanel.html")
    page.wait_for_timeout(500)
    page.click("#btn-theme")
    page.wait_for_timeout(200)
    print("toggle dark→light:", page.evaluate("document.documentElement.dataset.theme"))
    shoot(page, "toggled-to-light")
    # 再切回
    page.click("#btn-theme")
    page.wait_for_timeout(200)
    print("toggle light→dark:", page.evaluate("document.documentElement.dataset.theme"))
    page.close()
    browser.close()
server.shutdown()
print("shots in", OUT)
