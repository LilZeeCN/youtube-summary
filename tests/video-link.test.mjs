// video-link.js 测试：历史库用 videoId 反解 URL / 判定平台
import { test } from "node:test";
import assert from "node:assert/strict";

const { videoUrlFromId, platformFromId, linkifyVideoTitles } = await import("../sidepanel/modules/video-link.js");

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

test("linkifyVideoTitles 把书名号引用变成可点击链接", () => {
  const videos = [
    { videoId: "rag1", title: "RAG 入门" },
    { videoId: "BV1ab411c7mD", title: "B站检索实战" },
  ];
  const text = "这一点与《RAG 入门》的结论一致；《RAG 入门》讲的是基础，而《B站检索实战》更偏落地，《不存在的视频》保持原样。";
  const out = linkifyVideoTitles(text, videos);
  assert.match(out, /\[《RAG 入门》\]\(https:\/\/www\.youtube\.com\/watch\?v=rag1\)/);
  assert.match(out, /\[《B站检索实战》\]\(https:\/\/www\.bilibili\.com\/video\/BV1ab411c7mD\)/);
  // 不在列表里的书名号保持原样
  assert.match(out, /《不存在的视频》/);
  // 同一标题多次出现都被替换
  assert.equal((out.match(/\[《RAG 入门》\]/g) || []).length, 2);
});

test("linkifyVideoTitles 对空列表与空文本安全", () => {
  assert.equal(linkifyVideoTitles("《随便说说》", []), "《随便说说》");
  assert.equal(linkifyVideoTitles("", [{ videoId: "v", title: "t" }]), "");
  assert.equal(linkifyVideoTitles(null, null), "");
});
