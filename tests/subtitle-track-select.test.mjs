import assert from "node:assert/strict";
import test from "node:test";

const { renderSubtitleTrackSelect } = await import(
  new URL("../sidepanel/modules/subtitle-track-select.js", import.meta.url)
);

test("the current subtitle track remains visible after refreshing the same video", () => {
  const select = { innerHTML: "", dataset: {} };
  const video = {
    videoId: "video-1",
    tracks: [{ name: "中文（简体）", kind: "" }],
  };

  renderSubtitleTrackSelect(select, video, 0);
  select.innerHTML = "";
  renderSubtitleTrackSelect(select, video, 0);

  assert.match(select.innerHTML, />中文（简体）<\/option>/);
});
