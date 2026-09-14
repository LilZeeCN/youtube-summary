// B站页面 MAIN 世界脚本：B站 SPA 没有原生导航事件，
// 通过 hook History API 感知路由变化（切视频/切分P），通知内容脚本。

(() => {
  if (window.__videoSummaryBiliBridgeInstalled) return;
  window.__videoSummaryBiliBridgeInstalled = true;

  const BRIDGE = "yt-summary-bridge";

  function fire() {
    window.postMessage(
      { source: BRIDGE, type: "NAV", payload: { videoId: null, url: location.href } },
      "*"
    );
  }

  for (const name of ["pushState", "replaceState"]) {
    const orig = history[name];
    if (typeof orig !== "function") continue;
    history[name] = function (...args) {
      const r = orig.apply(this, args);
      setTimeout(fire, 0);
      return r;
    };
  }
  window.addEventListener("popstate", fire);
})();
