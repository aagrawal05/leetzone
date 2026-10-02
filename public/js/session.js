// Identity and the extension bridge. The site owns identity: {token, player}
// lives in localStorage and is mirrored to the extension over postMessage, as
// docs/DESIGN.md "Session flow" lays out.

import { api, configure } from "./api.js";

const SESSION_KEY = "leetzone.session";
const LOBBY_KEY = "leetzone.lobby";
const SITE = "leetzone-site";
const EXT = "leetzone-ext";

const listeners = new Set();
let session = read(SESSION_KEY);
let lobbyCode = session ? read(LOBBY_KEY) : null;

// localStorage can throw (private windows, blocked site data); the page then
// just forgets you on reload.
function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* see read() */ }
}

export const token = () => session?.token ?? null;
export const player = () => session?.player ?? null;
export const currentLobby = () => lobbyCode;

/** fn("identity") when the player signs in or out, fn("extension") when the
 *  extension announces itself. Returns an unsubscribe. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function signIn(tok, who) {
  session = { token: tok, player: { id: who.id, name: who.name } };
  write(SESSION_KEY, session);
  changed();
}

export function signOut() {
  if (!session) return;
  session = null;
  lobbyCode = null;
  write(SESSION_KEY, null);
  write(LOBBY_KEY, null);
  changed();
}

/** The lobby this player is in right now, or null. The extension follows it. */
export function setLobby(code) {
  code = code || null;
  if (code === lobbyCode) return;
  lobbyCode = code;
  write(LOBBY_KEY, code);
  pushSession();
}

export const loginLink = () => `${location.origin}/#token=${encodeURIComponent(session.token)}`;

function changed() {
  pushSession();
  for (const fn of listeners) fn("identity");
}

// ---- extension bridge ------------------------------------------------------

/** The extension's version, or null. site-bridge.js sets this at document_start. */
export const extensionVersion = () => document.documentElement.dataset.leetzoneExt ?? null;

function post(message) {
  window.postMessage({ source: SITE, ...message }, location.origin);
}

function pushSession() {
  post({ type: "session", session: session ? { token: session.token, player: session.player, lobbyCode } : null });
}

function onMessage(event) {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.source !== EXT || event.data.type !== "hello") return;
  if (event.data.version) document.documentElement.dataset.leetzoneExt = event.data.version;
  pushSession();
  for (const fn of listeners) fn("extension");
}

// ---- boot ------------------------------------------------------------------

/** Handle a /#token=... login link: strip the fragment, verify, store.
 *  Resolves to "ok", "bad", "busy" or null (no link). A link never replaces a
 *  different player already signed in here: their token exists nowhere else. */
export async function consumeLoginLink() {
  const match = /^#token=(.+)$/.exec(location.hash);
  if (!match) return null;
  history.replaceState(history.state, "", location.pathname + location.search);
  try {
    const tok = decodeURIComponent(match[1]);
    const who = await api.me(tok);
    if (session && session.token !== tok) return "busy";
    signIn(tok, who);
    return "ok";
  } catch {
    return "bad";
  }
}

/** Resolves to the login-link outcome so the caller can say something. */
export async function boot() {
  configure({ getToken: token, onUnauthorized: signOut });
  window.addEventListener("message", onMessage);
  // Another tab signed in or out.
  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_KEY && event.key !== LOBBY_KEY) return;
    const was = token();
    session = read(SESSION_KEY);
    lobbyCode = session ? read(LOBBY_KEY) : null;
    if (token() !== was) for (const fn of listeners) fn("identity");
  });
  post({ type: "ping" });
  const link = await consumeLoginLink();
  if (!link) pushSession();
  return link;
}
