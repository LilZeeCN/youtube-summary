// theme.js 测试：偏好解析与 <html data-theme> 写入（浏览器 API 用最小桩替代）。
import { test } from "node:test";
import assert from "node:assert/strict";

function installBrowserMock({ prefersLight }) {
  globalThis.window = {
    matchMedia: (query) => ({
      matches: query === "(prefers-color-scheme: light)" ? prefersLight : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
  globalThis.document = { documentElement: { dataset: {} } };
}

const { resolveTheme, applyTheme } = await import("../sidepanel/modules/theme.js");

test("显式偏好原样返回，未知值回退 auto 语义", () => {
  installBrowserMock({ prefersLight: true });
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("dark"), "dark");
  assert.equal(resolveTheme("auto"), "light"); // 系统是亮色
});

test("auto 偏好跟随系统解析", () => {
  installBrowserMock({ prefersLight: false });
  assert.equal(resolveTheme("auto"), "dark");
  assert.equal(resolveTheme(undefined), "dark");
  assert.equal(resolveTheme("垃圾值"), "dark");
});

test("applyTheme 把解析结果写入 <html data-theme>", () => {
  installBrowserMock({ prefersLight: true });
  assert.equal(applyTheme("auto"), "light");
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(applyTheme("dark"), "dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
});
