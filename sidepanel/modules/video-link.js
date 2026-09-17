// videoId 反解回可打开的 URL：YouTube 是 11 位 id；B站缓存键形如 "BV…?p=N"。
// 历史库用它把一条记录变回可点击跳转的视频地址。

export function videoUrlFromId(videoId) {
  const id = String(videoId || "").trim();
  if (!id) return "";
  if (id.startsWith("BV")) {
    const [bvid, query = ""] = id.split("?");
    const page = new URLSearchParams(query).get("p");
    const base = `https://www.bilibili.com/video/${bvid}`;
    return page && page !== "1" ? `${base}?p=${page}` : base;
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

export function platformFromId(videoId) {
  return String(videoId || "").startsWith("BV") ? "bilibili" : "youtube";
}

// 把回答中的《视频标题》书名号引用变成可点击的 Markdown 链接（渲染层支持 [文本](url)）。
// 只处理列表里真实存在的标题，流式半截标题不匹配时原样保留，后续 delta 会补全。
export function linkifyVideoTitles(text, videos) {
  let output = String(text || "");
  for (const video of videos || []) {
    const title = String(video && video.title || "").trim();
    if (!title || !video.videoId) continue;
    const quoted = `《${title}》`;
    if (output.includes(quoted)) {
      output = output.split(quoted).join(`[${quoted}](${videoUrlFromId(video.videoId)})`);
    }
  }
  return output;
}
