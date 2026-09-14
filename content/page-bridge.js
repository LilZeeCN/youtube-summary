// 运行在页面 MAIN 世界：直接访问 YouTube 播放器实例与 SPA 导航事件。
// 与隔离世界的 content.js 通过 window.postMessage 通信。

(() => {
  if (globalThis.__videoSummaryPageBridgeInstalled) return;
  globalThis.__videoSummaryPageBridgeInstalled = true;

  const BRIDGE = "yt-summary-bridge";
  const CS = "yt-summary-cs";
  const captionCacheTools = globalThis.__videoSummaryYoutubeCaptionCache;
  const capturedCaptions = captionCacheTools ? captionCacheTools.createStore() : null;
  if (captionCacheTools && capturedCaptions) {
    captionCacheTools.installCapture(capturedCaptions, globalThis);
  }

  function videoIdFromLocation() {
    try {
      const u = new URL(location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
    } catch (e) {}
    return null;
  }

  function trackDisplayName(track) {
    const name = track.name;
    if (!name) return track.languageCode || "未知";
    if (name.simpleText) return name.simpleText;
    if (Array.isArray(name.runs)) return name.runs.map((r) => r.text).join("");
    return track.languageCode || "未知";
  }

  function readPlayer() {
    let data = null;
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        data = player.getPlayerResponse();
      }
    } catch (e) {}
    if (!data || !data.videoDetails) {
      data = window.ytInitialPlayerResponse || null;
    }
    return data;
  }

  function shape(data) {
    const urlId = videoIdFromLocation();
    const details = (data && data.videoDetails) || {};
    const captionRenderer =
      (data && data.captions && data.captions.playerCaptionsTracklistRenderer) || null;
    const tracks = (captionRenderer && captionRenderer.captionTracks) || [];
    return {
      ready: !!(data && details.videoId),
      matched: !urlId || details.videoId === urlId,
      videoId: details.videoId || urlId,
      title: details.title || document.title.replace(" - YouTube", ""),
      author: details.author || "",
      // 描述里常有 UP主手写的章节时间表与专有名词规范写法，总结时是免费的准确率来源
      description: details.shortDescription || "",
      lengthSeconds: Number(details.lengthSeconds) || 0,
      isLive: !!details.isLiveContent,
      pageType: location.pathname.startsWith("/shorts/")
        ? "shorts"
        : location.pathname === "/watch"
          ? "watch"
          : "other",
      tracks: tracks.map((t) => ({
        baseUrl: t.baseUrl,
        lang: t.languageCode || "",
        name: trackDisplayName(t),
        kind: t.kind || "",
      })),
    };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  const ANDROID_VR_CLIENT = {
    clientName: "ANDROID_VR",
    clientVersion: "1.65.10",
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    androidSdkVersion: 32,
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    osName: "Android",
    osVersion: "12L",
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0,
  };

  const captionTracksCache = new Map();

  function ytcfgGet(name) {
    try {
      return window.ytcfg && typeof window.ytcfg.get === "function"
        ? window.ytcfg.get(name)
        : null;
    } catch (e) {
      return null;
    }
  }

  // Web 播放器近来会给出能返回 200、但正文为空的 timedtext URL。
  // 用页面自身的 visitorData 请求 Android VR player，可得到仍然有效的签名字幕 URL。
  async function fetchFreshCaptionTracks(videoId) {
    if (!videoId) return [];
    if (captionTracksCache.has(videoId)) return captionTracksCache.get(videoId);

    const visitorData =
      ytcfgGet("VISITOR_DATA") ||
      (ytcfgGet("INNERTUBE_CONTEXT") &&
        ytcfgGet("INNERTUBE_CONTEXT").client &&
        ytcfgGet("INNERTUBE_CONTEXT").client.visitorData) ||
      "";
    const client = { ...ANDROID_VR_CLIENT };
    if (visitorData) client.visitorData = visitorData;

    const body = {
      context: { client },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    };
    const signatureTimestamp = Number(ytcfgGet("STS"));
    if (Number.isFinite(signatureTimestamp) && signatureTimestamp > 0) {
      body.playbackContext = {
        contentPlaybackContext: {
          html5Preference: "HTML5_PREF_WANTS",
          signatureTimestamp,
        },
      };
    }

    const headers = {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "28",
      "X-YouTube-Client-Version": ANDROID_VR_CLIENT.clientVersion,
    };
    if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;

    let lastReason = "";
    for (const credentials of ["include", "omit"]) {
      const response = await fetch("/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        credentials,
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      const renderer =
        data && data.captions && data.captions.playerCaptionsTracklistRenderer;
      const tracks = (renderer && renderer.captionTracks) || [];
      if (response.ok && tracks.length) {
        const shaped = tracks.map((t) => ({
          baseUrl: t.baseUrl,
          lang: t.languageCode || "",
          name: trackDisplayName(t),
          kind: t.kind || "",
        }));
        captionTracksCache.set(videoId, shaped);
        return shaped;
      }
      lastReason =
        (data && data.playabilityStatus &&
          (data.playabilityStatus.reason || data.playabilityStatus.status)) ||
        `HTTP ${response.status}`;
    }
    throw new Error(lastReason || "无法刷新字幕地址");
  }

  // 刚切完视频时 getPlayerResponse 可能还是上一个视频的数据，轮询直到与 URL 一致
  async function getPlayerWithRetry() {
    let last = null;
    for (let i = 0; i < 14; i++) {
      last = shape(readPlayer());
      if (last.ready && last.matched) return last;
      await sleep(350);
    }
    return last || shape(null);
  }

  async function getCapturedCaption(payload) {
    if (!capturedCaptions) return null;
    const waitMs = Math.max(0, Math.min(5000, Number(payload && payload.waitMs) || 0));
    const deadline = Date.now() + waitMs;
    do {
      const hit = capturedCaptions.find(
        payload && payload.baseUrl,
        payload && payload.videoId
      );
      if (hit) return hit;
      if (Date.now() >= deadline) return null;
      await sleep(100);
    } while (true);
  }

  window.addEventListener("message", async (ev) => {
    const d = ev.data;
    if (!d || d.source !== CS || !d.type) return;
    if (d.type === "GET_PLAYER") {
      const payload = await getPlayerWithRetry();
      window.postMessage({ source: BRIDGE, id: d.id, payload }, "*");
    }
    if (d.type === "GET_CAPTURED_CAPTION_TEXT") {
      const payload = await getCapturedCaption(d.payload);
      window.postMessage({ source: BRIDGE, id: d.id, payload }, "*");
    }
    if (d.type === "REFRESH_CAPTION_TRACKS") {
      let payload;
      try {
        const videoId = String((d.payload && d.payload.videoId) || "");
        if (!videoId || videoId !== videoIdFromLocation()) {
          throw new Error("视频已切换，已取消刷新字幕地址");
        }
        payload = { tracks: await fetchFreshCaptionTracks(videoId), error: "" };
      } catch (e) {
        payload = { tracks: [], error: (e && e.message) || String(e) };
      }
      window.postMessage({ source: BRIDGE, id: d.id, payload }, "*");
    }
    if (d.type === "FETCH_CAPTION_TEXT") {
      let payload;
      try {
        const url = new URL(d.payload && d.payload.url);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "www.youtube.com" ||
          url.pathname !== "/api/timedtext"
        ) {
          throw new Error("拒绝访问非 YouTube 字幕地址");
        }
        const response = await fetch(url.href, {
          credentials: "include",
          cache: "no-store",
        });
        payload = {
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        };
      } catch (e) {
        payload = { ok: false, status: 0, text: "", error: (e && e.message) || String(e) };
      }
      window.postMessage({ source: BRIDGE, id: d.id, payload }, "*");
    }
    if (d.type === "GET_PLAYER_CAPTIONS") {
      // 从播放器字幕模块直接取当前轨道数据（json3 形状），字幕 URL 直拉失败时的回退
      let payload = null;
      try {
        const player = document.getElementById("movie_player");
        if (player && typeof player.loadModule === "function") {
          try {
            player.loadModule("captions");
          } catch (e) {}
          if (typeof player.getOption === "function") {
            payload = player.getOption("captions", "track") || null;
          }
        }
      } catch (e) {}
      window.postMessage({ source: BRIDGE, id: d.id, payload }, "*");
    }
  });

  // YouTube SPA 切换视频时触发，通知 content.js
  window.addEventListener("yt-navigate-finish", () => {
    window.postMessage(
      {
        source: BRIDGE,
        type: "NAV",
        payload: { videoId: videoIdFromLocation(), url: location.href },
      },
      "*"
    );
  });
})();
