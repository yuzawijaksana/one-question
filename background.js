/* One Question — Zen startup helper
 * chrome_url_overrides handles Ctrl/Cmd+T and normal new tabs.
 * Zen can still open its own startup/home tab when the browser launches,
 * so this listener turns the browser's empty/default startup tab into One Question.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

function isStartupPage(url) {
  if (!url) return false;
  return url === "about:home" || url === "about:newtab" || url === "about:blank";
}

async function showOneQuestionOnStartup() {
  try {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !isStartupPage(tab.url)) return;

    await api.tabs.update(tab.id, {
      url: api.runtime.getURL("newtab_2.html")
    });
  } catch (error) {
    console.warn("One Question startup redirect failed:", error);
  }
}

api.runtime.onStartup.addListener(showOneQuestionOnStartup);
api.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    showOneQuestionOnStartup();
  }
});