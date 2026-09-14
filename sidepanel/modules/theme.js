// 主题偏好解析：auto 跟随系统，light/dark 显式指定。
// 解析结果写入 <html data-theme>，供 theme-light.css 覆盖；暗色是默认态，无需属性。

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemPrefersLight() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(LIGHT_QUERY).matches
    : false;
}

export function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersLight() ? "light" : "dark";
}

export function applyTheme(preference) {
  const resolved = resolveTheme(preference);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

// 系统主题变化时回调（调用方决定只在 auto 偏好下重新应用），返回取消函数
export function observeSystemTheme(callback) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(LIGHT_QUERY);
  const listener = () => callback();
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
