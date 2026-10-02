// Isolated world, document_start, on the LeetZone site.
//
// The site owns identity. This copies its session into the extension (through
// the background, which records which server it came from) and lets the site
// see that the extension is installed. See docs/DESIGN.md, "Session flow".
(() => {
  "use strict";
  if (window.top !== window) return;

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  if (!alive()) return;

  const version = chrome.runtime.getManifest().version;
  const hello = () => window.postMessage({ source: "leetzone-ext", type: "hello", version }, location.origin);

  // Synchronous detection for the page's own scripts.
  document.documentElement.dataset.leetzoneExt = version;

  // The extension was reloaded or removed under this page: stop advertising.
  function teardown() {
    window.removeEventListener("message", onMessage);
    delete document.documentElement.dataset.leetzoneExt;
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== "leetzone-site") return;
    if (!alive()) return teardown();
    if (msg.type === "ping") {
      hello();
    } else if (msg.type === "session") {
      try {
        chrome.runtime.sendMessage({ type: "session", session: msg.session ?? null }).catch(() => {
          if (!alive()) teardown();
        });
      } catch {
        teardown();
      }
    }
  }

  window.addEventListener("message", onMessage);
  // Usually fires before the page is listening, which is why the page also pings.
  hello();
})();
