// video-link.js 测试：历史库用 videoId 反解 URL / 判定平台
import { test } from "node:test";
import assert from "node:assert/strict";

const { videoUrlFromId, platformFromId } = await import("../sidepanel/modules/video-link.js");

test("YouTube videoId 拼成 watch 地址", () => {
  assert.equal(
    videoUrlFromId("dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
});

test("B站 videoId 保留分 P，P1 省略参数", () => {
  assert.equal(
    videoUrlFromId("BV1ab411c7mD?p=3"),
    "https://www.bilibili.com/video/BV1ab411c7mD?p=3"
  );
  assert.equal(
    videoUrlFromId("BV1ab411c7mD?p=1"),
    "https://www.bilibili.com/video/BV1ab411c7mD"
  );
  assert.equal(
    videoUrlFromId("BV1ab411c7mD"),
    "https://www.bilibili.com/video/BV1ab411c7mD"
  );
});

test("空值返回空字符串，不产出无效地址", () => {
  assert.equal(videoUrlFromId(""), "");
  assert.equal(videoUrlFromId(null), "");
});

test("platformFromId 按 BV 前缀判定平台", () => {
  assert.equal(platformFromId("BV1ab411c7mD?p=2"), "bilibili");
  assert.equal(platformFromId("dQw4w9WgXcQ"), "youtube");
});
