// Optional identity entry. Never redirect, mutate game state, or treat login as a quota switch.
export function authMessage(data) {
  if (!data || typeof data !== "object" || typeof data.configured !== "boolean") throw new Error("invalid_status");
  if (["upstream_failed", "state_invalid", "authorization_incomplete", "authorization_failed", "access_denied"].includes(data.reason))
    return "授权未完成或未成功，已回退到公共参考模式。你可以继续游戏，不必重新开始。";
  if (!data.configured) return "OAuth 尚未配置，当前使用公共参考模式。初始化与真实授权将在后续接入。";
  if (data.authenticated) return "个性化参考尚未启用，本阶段仍使用公共参考。不会把身份授权视为个人搜索额度。";
  return "尚未获得知乎授权，当前使用公共参考模式。真实授权回调尚未接入，不会跳转到授权页。";
}

export function mountAuth(root = document, fetchImpl = fetch) {
  const entry = root.querySelector("#zhihu-entry"), dialog = root.querySelector("#zhihu-dialog");
  if (!entry || !dialog) return;
  const detail = root.querySelector("#zhihu-auth-detail"), retry = root.querySelector("#zhihu-retry");
  let pending = false;
  async function refresh() {
    if (pending) return;
    pending = true; retry.disabled = true; retry.textContent = "检查中…";
    detail.setAttribute("aria-busy", "true");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetchImpl("/api/auth/zhihu/status", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("unavailable");
      detail.textContent = authMessage(await response.json());
    } catch {
      detail.textContent = "登录服务暂不可用，已回退到公共参考模式。无需登录，可以继续当前游戏；网络恢复后可重新检查。";
    } finally {
      clearTimeout(timer); pending = false; retry.disabled = false; retry.textContent = "重新检查";
      detail.removeAttribute("aria-busy");
    }
  }
  entry.addEventListener("click", () => { dialog.showModal(); dialog.scrollTop = 0; refresh(); });
  root.querySelector("#zhihu-close").addEventListener("click", () => dialog.close());
  root.querySelector("#zhihu-continue").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => entry.focus({ preventScroll: true }));
  retry.addEventListener("click", refresh);
  // Enable only after events are bound; status requests never block playing or opening the dialog.
  entry.disabled = false;
  refresh();
}
if (typeof document !== "undefined") mountAuth();
