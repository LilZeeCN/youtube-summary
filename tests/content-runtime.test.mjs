import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const contentScript = await readFile(
  new URL("../content/content.js", import.meta.url),
  "utf8"
);

test("扩展重新加载后，旧页面收到导航消息不会抛出上下文失效错误", () => {
  let pageMessageListener = null;
  const context = {
    URL,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    console,
    location: {
      hostname: "www.youtube.com",
      href: "https://www.youtube.com/watch?v=test",
      pathname: "/watch",
    },
    document: {
      title: "测试视频",
      querySelector: () => null,
    },
    window: {
      addEventListener(type, listener) {
        if (type === "message") pageMessageListener = listener;
      },
      removeEventListener() {},
      postMessage() {},
    },
    chrome: {
      runtime: {
        id: "abcdefghijklmnop",
        onMessage: { addListener() {} },
        sendMessage() {
          throw new Error("Extension context invalidated.");
        },
      },
    },
  };

  vm.runInNewContext(contentScript, context);
  assert.equal(typeof pageMessageListener, "function");
  assert.doesNotThrow(() => {
    pageMessageListener({
      data: {
        source: "yt-summary-bridge",
        type: "NAV",
        payload: { videoId: "next-video" },
      },
    });
  });
});
