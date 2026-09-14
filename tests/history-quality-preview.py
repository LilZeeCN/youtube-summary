# 历史库 + 质检条的功能与视觉验证（chrome mock 注入，Playwright + 系统 Chrome）
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path("/tmp/feature-shots")
OUT.mkdir(exist_ok=True)

BAD_SUMMARY = {
    "videoType": "general",
    "thesis": "这是一个被刻意构造的低质量总结，用于验证质检条是否出现。",
    "keyPoints": [
        {"timestamp": 10, "text": "只有一个要点，而且没有任何字幕依据"},
        {"timestamp": 12, "text": "第二个要点和上一个时间挨得很近"},
    ],
    "chapters": [],
    "extras": None,
}

CHROME_MOCK = r"""
const tabUpdates = [];
const settings = {activeProfileId: 'profile-1', autoSummarize: false, theme: 'THEME_PLACEHOLDER'};
const profiles = [{
  id: 'profile-1', name: 'DeepSeek · 测试', provider: 'openai',
  apiUrl: 'http://127.0.0.1:9999/v1', apiKey: '', model: 'deepseek-chat'
}];
const db = {
  settings,
  modelProfiles: profiles,
  'cache:preview:summary': {videoId: 'preview', kind: 'summary', ts: 1757700000000, title: '当前视频（质检不达标）', data: BAD_SUMMARY_PLACEHOLDER},
  'cache:yt-abcdef12345:summary': {videoId: 'yt-abcdef12345', kind: 'summary', ts: 1757690000000, title: 'React Server Components 完全指南', data: {}},
  'cache:yt-abcdef12345:chat': {videoId: 'yt-abcdef12345', kind: 'chat', ts: 1757690500000, title: 'React Server Components 完全指南', data: []},
  'cache:yt-abcdef12345:mindmap': {videoId: 'yt-abcdef12345', kind: 'mindmap', ts: 1757691000000, title: 'React Server Components 完全指南', data: {}},
  'cache:BV1ab411c7mD?p=2:summary': {videoId: 'BV1ab411c7mD?p=2', kind: 'summary', ts: 1757600000000, title: '操作系统公开课 · P2 进程与线程', data: {}},
  'cache:BV1ab411c7mD?p=2:deepRead': {videoId: 'BV1ab411c7mD?p=2', kind: 'deepRead', ts: 1757600500000, title: '操作系统公开课 · P2 进程与线程', data: 'x'},
};
window.__tabUpdates = tabUpdates;
window.chrome = {
  storage: { local: {
    get: async (keys) => {
      if (keys === null || keys === undefined) return {...db};
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in db) out[k] = db[k];
      return out;
    },
    set: async (obj) => { Object.assign(db, obj); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete db[k]; }
  }},
  runtime: { id: 'test', sendMessage: async () => {}, onMessage: {addListener: () => {}} },
  tabs: {
    get: async () => ({id: 7, active: true, url: 'https://www.youtube.com/watch?v=preview'}),
    query: async () => [{id: 7, active: true, url: 'https://www.youtube.com/watch?v=preview'}],
    update: async (id, props) => { tabUpdates.push({id, url: props.url}); return {}; },
    create: async (props) => { tabUpdates.push({created: true, url: props.url}); return {}; },
    sendMessage: async (_id, message) => {
      if (message.type === 'GET_INFO') return {ok: true, info: {
        videoId: 'preview', title: '当前视频（质检不达标）', pageType: 'watch',
        tracks: [{name: '中文（自动）', lang: 'zh'}], lengthSeconds: 1800, description: ''
      }};
      if (message.type === 'GET_SUBTITLES') return {ok: true, cues: [
        {start: 0, dur: 3, text: '测试字幕一'}, {start: 4, dur: 3, text: '测试字幕二'}
      ], track: {name: '中文（自动）', index: 0}};
      if (message.type === 'GET_TIME') return {ok: true, time: 1, paused: false};
      return {ok: true};
    },
    onActivated: {addListener: () => {}},
    onUpdated: {addListener: () => {}},
  }
};
"""

MOCK = CHROME_MOCK.replace("BAD_SUMMARY_PLACEHOLDER", json.dumps(BAD_SUMMARY, ensure_ascii=False))


class Server(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def run(browser, theme):
    page = browser.new_page(viewport={"width": 460, "height": 840})
    page.add_init_script(MOCK.replace("THEME_PLACEHOLDER", theme))
    page.goto("http://127.0.0.1:8953/sidepanel/sidepanel.html")
    page.wait_for_timeout(600)

    results = []
    ok = lambda label: results.append(f"  PASS {label}")
    bad = lambda label: results.append(f"! FAIL {label}")

    # --- 质检条 ---
    banner = page.locator("#sum-quality")
    if banner.is_visible():
        text = banner.inner_text()
        ok(f"质检条可见: {text[:50]}…")
        if "重新总结" in text:
            ok("质检条含「重新总结」按钮")
        else:
            bad("质检条缺少重试按钮")
        if "总结论或要点数量不足" in text and "缺少字幕依据" in text:
            ok("structure + evidence 两条警示文案都在")
        else:
            bad("警示文案缺失")
    else:
        bad("质检条未显示（缓存恢复的坏总结应触发）")
    page.screenshot(path=str(OUT / f"{theme}-quality-banner.png"))

    # --- 历史页 ---
    page.click('[data-tab="history"]')
    page.wait_for_timeout(400)
    rows = page.locator(".history-row")
    count = rows.count()
    (ok if count == 3 else bad)(f"历史记录 3 条（实际 {count}）")
    meta = rows.nth(1).inner_text()
    (ok if "React Server Components" in meta else bad)(f"第二条是 RSC 视频")
    (ok if "总结 · 对话 · 导图" in meta else bad)(f"类型标签合并显示: {meta.splitlines()[-1]}")
    (ok if "YouTube" in meta else bad)("平台标签 YouTube")
    bili = rows.nth(2).inner_text()
    (ok if "B站" in bili and "精读" in bili else bad)("B站条目含平台与精读标签")
    page.screenshot(path=str(OUT / f"{theme}-history.png"))

    # --- 搜索 ---
    page.fill("#history-search", "操作系统")
    page.wait_for_timeout(400)
    count = page.locator(".history-row").count()
    (ok if count == 1 else bad)(f"搜索『操作系统』过滤后 1 条（实际 {count}）")
    page.fill("#history-search", "不存在的词xyz")
    page.wait_for_timeout(400)
    empty = page.locator(".history-list .subs-empty")
    (ok if empty.count() == 1 else bad)("无结果时显示空态")
    page.fill("#history-search", "")
    page.wait_for_timeout(400)

    # --- 跳转 ---
    page.locator(".history-row").nth(1).click()
    page.wait_for_timeout(300)
    updates = page.evaluate("window.__tabUpdates")
    (ok if len(updates) == 1 and "yt-abcdef12345" in updates[0].get("url", "") else bad)(
        f"点击跳转调用 tabs.update: {updates}")

    # --- 删除 ---
    before = page.locator(".history-row").count()
    page.locator(".history-row").nth(0).locator("button[data-act='del']").click()
    page.wait_for_timeout(300)
    after = page.locator(".history-row").count()
    (ok if after == before - 1 else bad)(f"删除后行数 {before}→{after}")

    print(f"[{theme}]")
    print("\n".join(results))
    page.close()


server = ThreadingHTTPServer(("127.0.0.1", 8953), Server)
Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    run(browser, "light")
    run(browser, "dark")
    browser.close()
server.shutdown()
print("shots in", OUT)
