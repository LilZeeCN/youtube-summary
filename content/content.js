// 隔离世界内容脚本：对侧边栏暴露 视频信息 / 字幕拉取 / 跳转控制。
// 字幕在页面同源环境里 fetch，避免任何跨域问题。

(() => {
  if (globalThis.__videoSummaryContentInstalled) return;
  globalThis.__videoSummaryContentInstalled = true;

  const BRIDGE = "yt-summary-bridge";
  let bridgeSeq = 0;
  const cuesCache = new Map(); // baseUrl -> cues
  const PLATFORM = /(^|\.)bilibili\.com$/.test(location.hostname) ? "bilibili" : "youtube";
  const biliProvenance = globalThis.__videoSummaryBiliProvenance;

  // 扩展重新加载后，旧标签页里的内容脚本会暂时保留，但 runtime 已经失效。
  // sendMessage 此时会同步抛错，不能只在返回值上挂 .catch()。
  function notifyRuntime(message) {
    try {
      if (!chrome.runtime?.id) return;
      const pending = chrome.runtime.sendMessage(message);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch (e) {}
  }

  function callBridge(type, payload, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const id = `req-${++bridgeSeq}`;
      const onMsg = (ev) => {
        const d = ev.data;
        if (d && d.source === BRIDGE && d.id === id) {
          cleanup();
          resolve(d.payload);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ source: "yt-summary-cs", type, id, payload }, "*");
    });
  }

  function getVideoEl() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector(".bpx-player-video-wrap video") ||
      document.querySelector("video")
    );
  }

  function pickTrack(tracks, preferIndex) {
    if (!tracks || !tracks.length) return null;
    if (Number.isInteger(preferIndex) && tracks[preferIndex]) return { ...tracks[preferIndex], index: preferIndex };
    const score = (t) => {
      let s = 0;
      // ai-zh / ai-en 是 AI 轨道的「目标语言」，按去掉前缀的语言参与打分；
      // AI 轨道 kind=asr 拿不到 +20，同级下 CC 字幕仍优先。
      const lang = (t.lang || "").toLowerCase().replace(/^ai[-_]/, "");
      if (/^zh/.test(lang)) s += 100;
      if (t.kind !== "asr") s += 20;
      if (lang === "en") s += 10;
      return s;
    };
    let best = 0;
    for (let i = 1; i < tracks.length; i++) {
      if (score(tracks[i]) > score(tracks[best])) best = i;
    }
    return { ...tracks[best], index: best };
  }

  // json3 事件粒度可能极碎（尤其自动字幕），按时间/字符窗口合并成句组
  function groupCues(cues) {
    const out = [];
    let cur = null;
    for (const c of cues) {
      if (
        cur &&
        c.start - (cur.start + cur.dur) < 1.2 &&
        cur.text.length + c.text.length < 220
      ) {
        cur.text += (/[。！？.!?]$/.test(cur.text) ? " " : "") + c.text;
        cur.dur = c.start + c.dur - cur.start;
      } else {
        cur = { start: c.start, dur: c.dur, text: c.text };
        out.push(cur);
      }
    }
    return out;
  }

  // 解析 timedtext 响应：json3（JSON）或 srv1/srv3（XML）两种族
  function parseTimedtext(text) {
    const trimmed = text.trim();
    const cues = [];
    if (trimmed.startsWith("{")) {
      const j = JSON.parse(trimmed);
      for (const ev of j.events || []) {
        if (!ev.segs) continue;
        const t = ev.segs
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (!t) continue;
        cues.push({ start: (ev.tStartMs || 0) / 1000, dur: (ev.dDurationMs || 0) / 1000, text: t });
      }
      return cues;
    }
    const doc = new DOMParser().parseFromString(trimmed, "text/xml");
    if (doc.querySelector("parsererror")) return cues;
    // srv1：<text start="12.3" dur="2.8">…
    for (const t of doc.querySelectorAll("text")) {
      const start = parseFloat(t.getAttribute("start"));
      const dur = parseFloat(t.getAttribute("dur")) || 0;
      const content = (t.textContent || "").replace(/\s+/g, " ").trim();
      if (Number.isFinite(start) && content) {
        cues.push({ start, dur, text: content });
      }
    }
    if (cues.length) return cues;
    // srv3：<p t="12300" d="2800">…
    for (const p of doc.querySelectorAll("p")) {
      const ms = parseInt(p.getAttribute("t"), 10);
      const d = parseInt(p.getAttribute("d"), 10) || 0;
      const content = (p.textContent || "").replace(/\s+/g, " ").trim();
      if (Number.isFinite(ms) && content) {
        cues.push({ start: ms / 1000, dur: d / 1000, text: content });
      }
    }
    return cues;
  }

  // 部分轨道 baseUrl 自带 fmt= 参数，直接追加会造成重复导致返回空内容，先剥掉
  function stripFmt(url) {
    return url
      .replace(/([?&])fmt=[^&]*/g, "$1")
      .replace(/&&+/g, "&")
      .replace(/[?&]$/, "");
  }

  async function capturedCues(track, videoId, waitMs = 0) {
    try {
      const captured = await callBridge(
        "GET_CAPTURED_CAPTION_TEXT",
        { baseUrl: track.baseUrl, videoId, waitMs },
        Math.max(2000, waitMs + 1500)
      );
      if (!captured || !captured.text) return null;
      const cues = parseTimedtext(captured.text);
      return cues.length ? cues : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchTrackCues(track) {
    const base = stripFmt(track.baseUrl);
    const attempts = [
      base + (base.includes("?") ? "&" : "?") + "fmt=json3",
      base,
      base + (base.includes("?") ? "&" : "?") + "fmt=srv1",
    ];
    let lastErr = "";
    for (const url of attempts) {
      let text = "";
      try {
        const result = await callBridge("FETCH_CAPTION_TEXT", { url }, 20000);
        if (!result) {
          lastErr = "页面字幕请求超时";
          continue;
        }
        if (!result.ok) {
          lastErr = result.error || `字幕接口返回 ${result.status}`;
          continue;
        }
        text = result.text || "";
      } catch (e) {
        lastErr = e.message;
        continue;
      }
      if (!text.trim()) {
        lastErr = "字幕接口返回空内容";
        continue;
      }
      try {
        const cues = parseTimedtext(text);
        if (cues.length) return { cues, error: "" };
        lastErr = "未解析到有效字幕";
      } catch (e) {
        lastErr = "字幕格式解析失败";
      }
    }
    return { cues: null, error: lastErr };
  }

  function equivalentTrack(tracks, original) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    return (
      tracks.find(
        (t) =>
          t.lang === original.lang && t.kind === original.kind && t.name === original.name
      ) ||
      tracks.find((t) => t.lang === original.lang && t.kind === original.kind) ||
      tracks.find((t) => t.lang === original.lang) ||
      null
    );
  }

  async function fetchCues(track, videoId) {
    if (cuesCache.has(track.baseUrl)) return cuesCache.get(track.baseUrl);

    // 最优路径：复用播放器已经成功拿到的字幕，不再制造第二次相同网络请求。
    let cues = await capturedCues(track, videoId);
    if (cues) {
      cuesCache.set(track.baseUrl, cues);
      return cues;
    }

    let result = await fetchTrackCues(track);
    if (result.cues) {
      cuesCache.set(track.baseUrl, result.cues);
      return result.cues;
    }

    // 播放器可能正在加载字幕，短暂等待捕获；这一步不会访问额外接口。
    cues = await capturedCues(track, videoId, 3500);
    if (cues) {
      cuesCache.set(track.baseUrl, cues);
      return cues;
    }

    // 只有原地址确实不可用、播放器也没有可复用响应时，才请求备用地址。
    const refreshed = await callBridge("REFRESH_CAPTION_TRACKS", { videoId }, 20000);
    const refreshedTrack = equivalentTrack(refreshed && refreshed.tracks, track);
    if (refreshedTrack) {
      const refreshedResult = await fetchTrackCues(refreshedTrack);
      if (refreshedResult.cues) {
        cuesCache.set(track.baseUrl, refreshedResult.cues);
        return refreshedResult.cues;
      }
      result = refreshedResult;
    }

    const refreshError = (refreshed && refreshed.error) || "";
    const lastErr = result.error || "未获取到有效字幕";
    const detail = refreshError ? `${lastErr}；刷新地址失败：${refreshError}` : lastErr;
    throw new Error(`字幕获取失败（${track.name || track.lang}）：${detail}`);
  }

  /* ---------------- B站 ---------------- */

  // B站 API 跨子域且字幕列表依赖登录 Cookie，统一走后台代理（host_permissions 下免 CORS、可带 Cookie）
  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome.runtime?.id) {
          reject(new Error("插件已更新，请刷新当前页面后重试"));
          return;
        }
        chrome.runtime.sendMessage({ type: "BILI_API", url }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message || "后台请求失败"));
          if (!res || !res.ok) {
            return reject(
              new Error((res && res.error) || `请求失败（${(res && res.status) || "网络错误"}）`)
            );
          }
          resolve(res);
        });
      } catch (e) {
        reject(new Error((e && e.message) || "插件后台连接已失效，请刷新页面"));
      }
    });
  }

  function biliIdsFromUrl() {
    try {
      const u = new URL(location.href);
      const m = u.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
      if (!m) return null;
      const page = Math.max(1, parseInt(u.searchParams.get("p") || "1", 10) || 1);
      return { bvid: m[1], page };
    } catch (e) {
      return null;
    }
  }

  function currentBiliVideoId() {
    const ids = biliIdsFromUrl();
    return ids ? `${ids.bvid}?p=${ids.page}` : null;
  }

  function assertExpectedVideo(actualVideoId, expectedVideoId) {
    if (expectedVideoId && actualVideoId !== expectedVideoId) {
      throw new Error("视频已切换，已丢弃不属于当前视频的字幕响应");
    }
  }

  const biliInfoCache = new Map(); // "bvid?p=n" -> { info, ts }

  async function biliGetInfo() {
    const ids = biliIdsFromUrl();
    if (!ids) {
      return {
        platform: "bilibili",
        pageType: "other",
        videoId: location.pathname,
        title: document.title.replace(/_哔哩哔哩.*$/, ""),
        tracks: [],
      };
    }
    const key = `${ids.bvid}?p=${ids.page}`;
    const hit = biliInfoCache.get(key);
    if (hit && Date.now() - hit.ts < 60000) return hit.info;

    // view 接口公开：拿 aid/cid/标题/分P 信息
    const viewRes = await bgFetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${ids.bvid}`
    );
    const view = JSON.parse(viewRes.text);
    if (view.code !== 0 || !view.data) {
      throw new Error(view.message || "B站视频信息获取失败");
    }
    const d = view.data;
    const pageData = (d.pages || []).find((p) => p.page === ids.page);
    const cid = pageData ? pageData.cid : d.cid;
    const title =
      (d.pages || []).length > 1 && pageData && pageData.part
        ? `${d.title} · P${ids.page} ${pageData.part}`
        : d.title;

    // 字幕列表优先用 wbi/v2：旧 v2 只返回原文 AI 轨道（ai-zh），翻译轨道（ai-en 等）
    // 拿不到，部分视频甚至一条都不给；两个接口均无需 WBI 签名，登录 Cookie 由后台代理携带。
    // player/v2 偶发返回被缓存的其他视频字幕轨道。AI 字幕 URL 内含 aid+cid，
    // 不匹配时绝不能继续使用，并绕过缓存重试一次。
    let tracks = [];
    let subtitleHint = "";
    for (let attempt = 0; attempt < 3 && !tracks.length; attempt++) {
      try {
        const playerPath = attempt === 0 ? "wbi/v2" : "v2";
        const playerUrl = biliProvenance.withCacheBust(
          `https://api.bilibili.com/x/player/${playerPath}?aid=${d.aid}&cid=${cid}`,
          `${Date.now()}-${attempt}`
        );
        const playerRes = await bgFetch(playerUrl);
        const player = JSON.parse(playerRes.text);
        if (player.code !== 0 || !player.data) {
          throw new Error(player.message || "B站字幕列表获取失败");
        }
        const subs = (player.data.subtitle && player.data.subtitle.subtitles) || [];
        const candidates = subs
          .filter((s) => s.subtitle_url)
          .map((s) => ({
            baseUrl: String(s.subtitle_url).startsWith("//")
              ? "https:" + s.subtitle_url
              : s.subtitle_url,
            lang: s.lan || "",
            name: s.lan_doc || s.lan || "字幕",
            kind: s.ai_type || /^ai[-_]/i.test(s.lan || "") ? "asr" : "",
          }));
        const invalidTrack = candidates.find(
          (track) => !biliProvenance.isOwnedSubtitleUrl(track.baseUrl, d.aid, cid)
        );
        if (invalidTrack) {
          subtitleHint = "B站返回了其他视频的字幕轨道，已自动拦截并重试";
          console.warn(
            `[视频总结助手] 已拦截错配字幕: aid=${d.aid} cid=${cid} url=${invalidTrack.baseUrl.slice(0, 110)}`
          );
          continue;
        }
        tracks = candidates;
      } catch (e) {
        subtitleHint = e.message;
      }
    }
    if (!tracks.length) {
      subtitleHint ||=
        "B站字幕需要先在浏览器登录 B站账号（AI 字幕也需要登录/大会员）；部分视频确实没有 CC 字幕";
    }

    const info = {
      platform: "bilibili",
      pageType: "watch",
      videoId: key,
      title,
      author: (d.owner && d.owner.name) || "",
      description: String(d.desc || ""),
      lengthSeconds: (pageData && pageData.duration) || d.duration || 0,
      isLive: false,
      tracks,
      subtitleHint,
      aid: d.aid,
      cid,
    };
    biliInfoCache.set(key, { info, ts: Date.now() });
    return info;
  }

  // 字幕 JSON：后台代理优先；失败时回退到页面上下文直接拉（hdslb 字幕 CDN 允许跨域）
  async function fetchSubtitleJson(url) {
    const requestUrl = biliProvenance.withCacheBust(
      url,
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    let bgError = null;
    try {
      return (await bgFetch(requestUrl)).text;
    } catch (e) {
      bgError = e;
    }
    try {
      const res = await fetch(requestUrl, { cache: "no-store" });
      if (res.ok) return await res.text();
    } catch (e) {}
    throw bgError;
  }

  async function biliGetSubtitles(trackIndex, expectedVideoId) {
    assertExpectedVideo(currentBiliVideoId(), expectedVideoId);
    const info = await biliGetInfo();
    assertExpectedVideo(info.videoId, expectedVideoId);
    assertExpectedVideo(currentBiliVideoId(), info.videoId);
    if (!info.tracks.length) throw new Error(info.subtitleHint || "该视频没有可用字幕");
    const track = pickTrack(info.tracks, trackIndex);
    if (!biliProvenance.isOwnedSubtitleUrl(track.baseUrl, info.aid, info.cid)) {
      throw new Error("已拦截不属于当前视频的字幕轨道，请重试");
    }
    if (!cuesCache.has(track.baseUrl)) {
      let cues = null;
      for (let attempt = 0; attempt < 2 && !cues; attempt++) {
        const text = await fetchSubtitleJson(track.baseUrl);
        assertExpectedVideo(currentBiliVideoId(), info.videoId);
        let body;
        try {
          body = JSON.parse(text).body;
        } catch (e) {
          throw new Error("B站字幕格式解析失败");
        }
        if (!biliProvenance.hasPlausibleCoverage(body, info.lengthSeconds)) {
          const lastEnd = (body || []).reduce(
            (max, cue) => Math.max(max, Number(cue.to) || 0),
            0
          );
          console.warn(
            `[视频总结助手] 已拦截覆盖范围异常的字幕: videoId=${info.videoId} ` +
              `时长=${info.lengthSeconds}s 末条=${lastEnd}s`
          );
          continue;
        }
        cues = (body || [])
          .map((b) => ({
            start: Number(b.from) || 0,
            dur: Math.max(0.1, (Number(b.to) || 0) - (Number(b.from) || 0)),
            text: String(b.content || "").replace(/\s+/g, " ").trim(),
          }))
          .filter((c) => c.text);
      }
      if (!cues || !cues.length) {
        throw new Error("B站字幕覆盖范围异常，已拦截错误内容，请重试");
      }
      console.info(
        `[视频总结助手] B站字幕下载: videoId=${info.videoId} 轨道=${track.name}(${track.lang}) url=${track.baseUrl.slice(0, 90)}`
      );
      cuesCache.set(track.baseUrl, cues);
    }
    return {
      cues: groupCues(cuesCache.get(track.baseUrl)),
      track,
      videoId: info.videoId,
      title: info.title,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg && msg.type) {
          case "PING":
            sendResponse({ ok: true });
            return;

          case "GET_INFO": {
            if (PLATFORM === "bilibili") {
              const info = await biliGetInfo();
              sendResponse({ ok: true, info });
              return;
            }
            const info = await callBridge("GET_PLAYER");
            if (!info) {
              sendResponse({ ok: false, error: "无法读取页面播放器数据" });
              return;
            }
            sendResponse({ ok: true, info: { platform: "youtube", ...info } });
            return;
          }

          case "GET_SUBTITLES": {
            if (PLATFORM === "bilibili") {
              const r = await biliGetSubtitles(
                msg.payload && msg.payload.trackIndex,
                msg.payload && msg.payload.videoId
              );
              console.info(
                `[视频总结助手] B站字幕: videoId=${r.videoId} "${r.title}" 轨道=${r.track.name} ${r.cues.length}条 首条=[${r.cues[0] && r.cues[0].text}]`
              );
              sendResponse({
                ok: true,
                cues: r.cues,
                videoId: r.videoId,
                title: r.title,
                track: { name: r.track.name, lang: r.track.lang, index: r.track.index },
              });
              return;
            }
            const info = await callBridge("GET_PLAYER");
            assertExpectedVideo(info && info.videoId, msg.payload && msg.payload.videoId);
            const track = info && pickTrack(info.tracks, msg.payload && msg.payload.trackIndex);
            if (!track) {
              sendResponse({ ok: false, error: "该视频没有可用字幕" });
              return;
            }
            const cues = await fetchCues(track, info.videoId);
            const grouped = groupCues(cues);
            console.info(
              `[视频总结助手] YouTube字幕: videoId=${info.videoId} "${info.title}" 轨道=${track.name} ${grouped.length}条 首条=[${grouped[0] && grouped[0].text}]`
            );
            sendResponse({
              ok: true,
              cues: grouped,
              videoId: info.videoId,
              title: info.title,
              track: { name: track.name, lang: track.lang, index: track.index },
            });
            return;
          }

          case "SEEK": {
            const v = getVideoEl();
            if (v) {
              v.currentTime = Math.max(0, Number(msg.payload.time) || 0);
              sendResponse({ ok: true });
            } else {
              sendResponse({ ok: false, error: "未找到视频元素" });
            }
            return;
          }

          case "GET_TIME": {
            const v = getVideoEl();
            sendResponse({ ok: true, time: v ? v.currentTime : 0, paused: v ? v.paused : true });
            return;
          }

          default:
            sendResponse({ ok: false, error: "未知消息类型" });
        }
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || String(e) });
      }
    })();
    return true; // 异步回复
  });

  // 页面世界报告 SPA 导航 → 转发给侧边栏
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d && d.source === BRIDGE && d.type === "NAV") {
      cuesCache.clear();
      biliInfoCache.clear();
      notifyRuntime({ type: "YT_VIDEO_CHANGED", videoId: d.payload.videoId });
    }
  });
})();
