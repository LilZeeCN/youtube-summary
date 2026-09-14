import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { URL, Date, WeakMap };
context.globalThis = context;
vm.runInNewContext(
  readFileSync(new URL("../content/youtube-caption-cache.js", import.meta.url), "utf8"),
  context
);
const cache = context.__videoSummaryYoutubeCaptionCache;

test("reuses the current player's successful subtitle response when a repeated request is empty", () => {
  const store = cache.createStore();
  const playerUrl =
    "https://www.youtube.com/api/timedtext?v=current-video&lang=zh-Hans&fmt=json3&expire=1&sig=old";
  const pluginUrl =
    "https://www.youtube.com/api/timedtext?v=current-video&lang=zh-Hans&fmt=srv1&expire=2&sig=new";

  assert.equal(store.remember(playerUrl, '{"events":[{"tStartMs":0}]}'), true);
  assert.equal(store.remember(pluginUrl, ""), false);
  assert.match(store.find(pluginUrl, "current-video").text, /events/);
});

test("never returns a cached subtitle response belonging to another video", () => {
  const store = cache.createStore();
  store.remember(
    "https://www.youtube.com/api/timedtext?v=unrelated-video&lang=zh-Hans&fmt=json3",
    "敌方兵力剩余不多"
  );

  assert.equal(
    store.find(
      "https://www.youtube.com/api/timedtext?v=current-video&lang=zh-Hans&fmt=json3",
      "current-video"
    ),
    null
  );
});

test("keeps translated and original language tracks separate", () => {
  const store = cache.createStore();
  store.remember(
    "https://www.youtube.com/api/timedtext?v=video-1&lang=en&tlang=zh-Hans&fmt=json3",
    "中文翻译"
  );

  assert.equal(
    store.find("https://www.youtube.com/api/timedtext?v=video-1&lang=en&fmt=json3", "video-1"),
    null
  );
});
