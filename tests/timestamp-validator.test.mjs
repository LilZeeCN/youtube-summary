import assert from "node:assert/strict";
import test from "node:test";

import { validateTimestamps } from "../sidepanel/modules/timestamp-validator.js";

const cues = [0, 5, 10.2, 20, 31, 45].map((start) => ({ start, text: "示例" }));

test("轻微偏差的时间戳吸附到最近的字幕时刻", () => {
  assert.equal(validateTimestamps("[00:11] 工具调用", cues), "[00:10] 工具调用");
  assert.equal(validateTimestamps("### [00:04] 开场", cues), "### [00:05] 开场");
});

test("明显越界的时间戳移除标记但保留正文", () => {
  assert.equal(validateTimestamps("- [12:00] 编造的要点", cues), "- 编造的要点");
});

test("时间轴内但远离任何字幕的时间戳保留（长静音段）", () => {
  const sparse = [{ start: 0 }, { start: 5 }, { start: 45 }];
  assert.equal(validateTimestamps("[00:26] 静音期内容", sparse), "[00:26] 静音期内容");
});

test("区间时间戳两端分别校验", () => {
  assert.equal(validateTimestamps("[00:04-00:47] 区间", cues), "[00:05-00:45] 区间");
});

test("小时制时间戳吸附后仍按 h:mm:ss 输出", () => {
  const long = [{ start: 0 }, { start: 3725 }];
  assert.equal(validateTimestamps("[1:01:59] 后段", long), "[1:02:05] 后段");
});

test("无字幕或无时间戳时原样返回", () => {
  assert.equal(validateTimestamps("[00:11] 文本", []), "[00:11] 文本");
  assert.equal(validateTimestamps("没有任何时间戳的文本", cues), "没有任何时间戳的文本");
  assert.equal(validateTimestamps("", cues), "");
});
