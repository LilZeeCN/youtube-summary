function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSubtitleTrackSelect(select, video, selectedIndex) {
  const tracks = (video && video.tracks) || [];
  select.innerHTML = tracks
    .map(
      (track, index) =>
        `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(
          track.name
        )}${track.kind === "asr" ? "（自动）" : ""}</option>`
    )
    .join("");
}
