// 后台：1) 点击工具栏图标打开侧边栏；2) 作为 B站 API 的代理（host_permissions 下免 CORS，
// 且能以浏览器里的登录 Cookie 请求 player/v2 拿字幕列表）。

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("[视频总结助手] 设置侧边栏行为失败:", err));
} else {
  // Safari 没有 Chrome 的 sidePanel API。用独立小窗口承载同一套界面，避免普通
  // toolbar popup 在失去焦点后关闭并中断长时间的总结请求。
  chrome.action.onClicked.addListener((tab) => {
    const tabId = Number(tab && tab.id);
    if (!Number.isInteger(tabId)) return;
    const url = new URL(chrome.runtime.getURL("sidepanel/sidepanel.html"));
    url.searchParams.set("tabId", String(tabId));
    chrome.windows.create({
      url: url.href,
      type: "popup",
      width: 460,
      height: 840,
    });
  });
}

const BILI_ALLOWED_HOSTS = /^(api\.bilibili\.com|www\.bilibili\.com|[\w-]+\.hdslb\.com)$/;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "BILI_API") return;
  (async () => {
    try {
      const url = new URL(msg.url);
      if (url.protocol !== "https:" || !BILI_ALLOWED_HOSTS.test(url.hostname)) {
        throw new Error("拒绝访问非 B站 域名");
      }
      const res = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
      });
      sendResponse({ ok: res.ok, status: res.status, text: await res.text() });
    } catch (e) {
      sendResponse({ ok: false, status: 0, text: "", error: (e && e.message) || String(e) });
    }
  })();
  return true; // 异步回复
});
