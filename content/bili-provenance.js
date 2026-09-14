(() => {
  if (globalThis.__videoSummaryBiliProvenance) return;

  // 原文 AI 字幕的 prod 段以 "{aid}{cid}" 数字串开头（后接十六进制尾巴），可精确校验归属；
  // 以长数字串开头但不匹配，说明内嵌的是其他视频的标识。AI 翻译轨道
  // （/bfs/ai_subtitle/prod/<哈希>）与 /bfs/subtitle/<哈希>.json 的 CC 字幕无法从 URL
  // 判断归属，只能放行，由字幕覆盖范围校验兜底拦截错配内容。
  function isOwnedSubtitleUrl(url, aid, cid) {
    try {
      const parsed = new URL(url, "https://www.bilibili.com");
      if (parsed.hostname !== "aisubtitle.hdslb.com") return true;
      const prod = parsed.pathname.match(/\/bfs\/ai_subtitle\/prod\/(\w{15,})/);
      if (!prod) return true;
      if (prod[1].startsWith(`${aid}${cid}`)) return true;
      return !/^\d{15,}/.test(prod[1]);
    } catch (_error) {
      return false;
    }
  }

  function withCacheBust(url, token = Date.now()) {
    const parsed = new URL(url, "https://www.bilibili.com");
    parsed.searchParams.set("_vsa", String(token));
    return parsed.href;
  }

  function hasPlausibleCoverage(body, durationSeconds) {
    if (!Array.isArray(body) || !body.length) return false;
    const duration = Number(durationSeconds) || 0;
    if (duration < 300) return true;
    const lastEnd = body.reduce((max, cue) => Math.max(max, Number(cue.to) || 0), 0);
    return lastEnd >= Math.min(duration * 0.2, 300);
  }

  globalThis.__videoSummaryBiliProvenance = Object.freeze({
    isOwnedSubtitleUrl,
    withCacheBust,
    hasPlausibleCoverage,
  });
})();
