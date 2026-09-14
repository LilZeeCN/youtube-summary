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
