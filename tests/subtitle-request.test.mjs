import assert from "node:assert/strict";
import test from "node:test";

const { SubtitleRequestCoordinator } = await import(
  new URL("../sidepanel/modules/subtitle-request.js", import.meta.url)
);

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("a subtitle response from an invalidated video is rejected", async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  const coordinator = new SubtitleRequestCoordinator((_trackIndex, videoId) =>
    videoId === "video-a" ? oldRequest.promise : newRequest.promise
  );

  const oldResult = coordinator.load("video-a", 0);
  coordinator.invalidate();
  const newResult = coordinator.load("video-b", 0);

  newRequest.resolve({ videoId: "video-b", cues: [{ text: "Pi Agent" }] });
  assert.equal((await newResult).cues[0].text, "Pi Agent");

  oldRequest.resolve({ videoId: "video-a", cues: [{ text: "唐僧" }] });
  await assert.rejects(oldResult, /过期字幕/);
});

test("a response claiming a different video is rejected", async () => {
  const coordinator = new SubtitleRequestCoordinator(async () => ({
    videoId: "unrelated-video",
    cues: [{ text: "唐僧" }],
  }));

  await assert.rejects(coordinator.load("pi-agent-video", 0), /视频不一致/);
});

test("concurrent requests for the same video and track share one load", async () => {
  let calls = 0;
  const request = deferred();
  const coordinator = new SubtitleRequestCoordinator(() => {
    calls += 1;
    return request.promise;
  });

  const first = coordinator.load("pi-agent-video", 0);
  const second = coordinator.load("pi-agent-video", 0);
  assert.equal(calls, 1);

  request.resolve({ videoId: "pi-agent-video", cues: [] });
  assert.strictEqual(await first, await second);
});
