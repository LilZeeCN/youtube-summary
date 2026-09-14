// YouTube 播放器已经成功加载字幕时，复用同一份响应，避免再次请求 timedtext
// 被风控返回空内容。该文件同时运行在 MAIN / ISOLATED 世界，因此只暴露纯工具。

(() => {
  if (globalThis.__videoSummaryYoutubeCaptionCache) return;

  const MAX_ENTRIES = 16;
  const TIMEDTEXT_HOST = "www.youtube.com";
  const TIMEDTEXT_PATH = "/api/timedtext";

  function describe(url) {
    try {
      const parsed = new URL(String(url), "https://www.youtube.com/");
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== TIMEDTEXT_HOST ||
        parsed.pathname !== TIMEDTEXT_PATH
      ) {
        return null;
      }
      return {
        url: parsed.href,
        videoId: parsed.searchParams.get("v") || "",
        lang: parsed.searchParams.get("lang") || "",
        tlang: parsed.searchParams.get("tlang") || "",
        kind: parsed.searchParams.get("kind") || "",
      };
    } catch (e) {
      return null;
    }
  }

  function createStore() {
    const entries = [];

    function remember(url, text) {
      const info = describe(url);
      const body = typeof text === "string" ? text : "";
      if (!info || !info.videoId || !body.trim()) return false;

      entries.push({ ...info, text: body, capturedAt: Date.now() });
      if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
      }
      return true;
    }

    function find(baseUrl, expectedVideoId) {
      const wanted = describe(baseUrl);
      if (!wanted) return null;
      const videoId = String(expectedVideoId || wanted.videoId || "");
      if (!videoId || (wanted.videoId && wanted.videoId !== videoId)) return null;

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.videoId !== videoId) continue;
        if (entry.lang !== wanted.lang) continue;
        if (entry.tlang !== wanted.tlang) continue;
        if (entry.kind !== wanted.kind) continue;
        return { url: entry.url, text: entry.text, capturedAt: entry.capturedAt };
      }
      return null;
    }

    return { remember, find };
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function installCapture(store, target = globalThis) {
    if (!store || !target || target.__videoSummaryCaptionCaptureInstalled) return;
    target.__videoSummaryCaptionCaptureInstalled = true;

    if (typeof target.fetch === "function") {
      const originalFetch = target.fetch;
      target.fetch = function (...args) {
        const url = requestUrl(args[0]);
        return originalFetch.apply(this, args).then((response) => {
          if (describe(url) && response && response.ok && typeof response.clone === "function") {
            response
              .clone()
              .text()
              .then((text) => store.remember(url, text))
              .catch(() => {});
          }
          return response;
        });
      };
    }

    const XHR = target.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const urls = new WeakMap();

      XHR.prototype.open = function (method, url, ...rest) {
        urls.set(this, requestUrl(url));
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.send = function (...args) {
        const xhr = this;
        const url = urls.get(xhr) || "";
        if (describe(url)) {
          xhr.addEventListener(
            "loadend",
            () => {
              try {
                if (xhr.status >= 200 && xhr.status < 300) {
                  store.remember(url, xhr.responseText || "");
                }
              } catch (e) {}
            },
            { once: true }
          );
        }
        return originalSend.apply(xhr, args);
      };
    }
  }

  globalThis.__videoSummaryYoutubeCaptionCache = {
    createStore,
    describe,
    installCapture,
  };
})();
