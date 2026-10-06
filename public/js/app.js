// Router and boot. Each view module exports mount(root, params), which may
// return a function to call when the view is replaced.

import { api } from "./api.js";
import * as session from "./session.js";
import { copy, toast } from "./ui/format.js";
import { h, replace, text } from "./ui/dom.js";

const routes = [
  { pattern: /^\/$/, nav: "play", load: () => import("./views/home.js") },
  { pattern: /^\/l\/([^/]+)\/?$/, nav: "play", load: () => import("./views/lobby.js") },
  { pattern: /^\/leaderboard\/?$/, nav: "leaderboard", load: () => import("./views/leaderboard.js") },
  { pattern: /^\/p\/([^/]+)\/?$/, nav: "leaderboard", load: () => import("./views/profile.js") },
];

const view = document.getElementById("view");
let unmount = null;
let renders = 0;
let shown = null;

async function render() {
  const turn = ++renders;
  const path = shown = location.pathname;
  const route = routes.find((r) => r.pattern.test(path));
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === route?.nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  unmount?.();
  unmount = null;

  if (!route) {
    document.title = "leetzone";
    return replace(view, h("h1", "Not found"), h("p.muted", "There is nothing at this address. ", h("a", { href: "/" }, "Go home")));
  }
  try {
    const module = await route.load();
    if (turn !== renders) return;
    const param = decodeURIComponent(route.pattern.exec(path)[1] ?? "");
    view.replaceChildren();
    unmount = module.mount(view, param) ?? null;
  } catch (err) {
    console.error(err);
    if (turn !== renders) return;
    // A module failed to load: most likely the server is mid-deploy.
    replace(view, h("p.muted.reconnecting", "Can't reach the server. Retrying"));
    setTimeout(() => turn === renders && render(), 3000);
  }
}

/** Go to a path on this site without a page load. */
export function navigate(path, { replace: swap = false } = {}) {
  if (path !== location.pathname) history[swap ? "replaceState" : "pushState"](null, "", path);
  render();
  window.scrollTo(0, 0);
}

// Same-origin links become client-side navigation; everything else is left alone.
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = event.target.closest?.("a[href]");
  if (!a || a.target || a.origin !== location.origin || a.hasAttribute("download")) return;
  if (a.pathname === location.pathname && a.hash) return;
  event.preventDefault();
  closeMenu();
  navigate(a.pathname);
  view.focus({ preventScroll: true });
});
// A hash-only change (the skip link, a login link) is not a route change.
window.addEventListener("popstate", () => { if (location.pathname !== shown) render(); });

// ---- header and footer -----------------------------------------------------

const who = document.getElementById("who");
const whoName = document.getElementById("who-name");
const whoMenu = document.getElementById("who-menu");

function closeMenu() {
  whoMenu.hidden = true;
  whoName.setAttribute("aria-expanded", "false");
}
whoName.addEventListener("click", () => {
  whoMenu.hidden = !whoMenu.hidden;
  whoName.setAttribute("aria-expanded", String(!whoMenu.hidden));
});
document.addEventListener("click", (event) => { if (!who.contains(event.target)) closeMenu(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !whoMenu.hidden) { closeMenu(); whoName.focus(); }
});
document.getElementById("who-copy").addEventListener("click", () => {
  closeMenu();
  copy(session.loginLink(), "login link copied: open it on another device to sign in as you");
});
document.getElementById("who-out").addEventListener("click", async () => {
  closeMenu();
  if (!confirm("Sign out? This browser will forget you. Without your login link you cannot get this name or its stats back.")) return;
  // Leave first, so a lobby is not left waiting on a player who cannot return.
  const code = session.currentLobby();
  if (code) await api.leave(code).catch(() => {});
  session.signOut();
  navigate("/");
});

function frame() {
  const me = session.player();
  who.hidden = !me;
  if (me) {
    text(whoName, me.name);
    document.getElementById("who-profile").setAttribute("href", `/p/${encodeURIComponent(me.name)}`);
  }
  const version = session.extensionVersion();
  const status = document.getElementById("ext-status");
  text(status, version ? `extension ${version} connected` : "extension not detected");
  status.classList.toggle("ok", Boolean(version));
  document.getElementById("ext-install").hidden = Boolean(version);
}

// ---- boot ------------------------------------------------------------------

session.onChange((what) => {
  frame();
  if (what === "identity") render();
});

function announce(link) {
  if (link === "ok") toast(`signed in as ${session.player().name}`);
  if (link === "bad") toast("That login link didn't work.", "bad");
  if (link === "busy") toast(`You're signed in as ${session.player().name}. Sign out first to use a login link.`, "bad");
}
// A login link opened in a tab that is already on the site.
window.addEventListener("hashchange", () => session.consumeLoginLink().then(announce));

const booting = session.boot();
frame();
render();
booting.then((link) => {
  announce(link);
  // The extension may have announced itself before the listener was attached.
  frame();
});
