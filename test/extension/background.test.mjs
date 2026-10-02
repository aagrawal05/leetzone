// The service worker's gate: who may send which message (extension/background.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SITE = "http://localhost:8787";
const SESSION = { token: "t", player: { id: "a", name: "adi" }, lobbyCode: "abcde" };

function background() {
  const stored = {};
  let listener;
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener: (fn) => (listener = fn) } },
    storage: {
      local: {
        get: async (key) => ({ [key]: stored[key] }),
        set: async (items) => void Object.assign(stored, items),
        remove: async (key) => void delete stored[key],
      },
    },
  };
  const ctx = vm.createContext({ chrome, self: { location: { origin: "chrome-extension://ext" } } });
  vm.runInContext(readFileSync(new URL("../../extension/background.js", import.meta.url), "utf8"), ctx);
  // Answers come from another realm: copy them so deepEqual compares structure.
  const send = (msg, sender) => new Promise((resolve) => listener(msg, { id: "ext", ...sender }, (r) => resolve(JSON.parse(JSON.stringify(r)))));
  return { stored, send };
}

test("session: only from a top frame of the site, shown or prerendered", async () => {
  const bg = background();
  const msg = { type: "session", session: SESSION };
  assert.deepEqual(await bg.send(msg, { origin: SITE, frameId: 4, documentLifecycle: "active" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await bg.send(msg, { origin: "https://leetcode.com", frameId: 0, documentLifecycle: "active" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await bg.send(msg, { origin: SITE, frameId: 0, documentLifecycle: "active", id: "other" }), { ok: false, error: "forbidden" });
  assert.equal(bg.stored.session, undefined);

  // Chrome prerenders the site (omnibox prediction): its top frame is not frame 0 yet.
  assert.deepEqual(await bg.send(msg, { origin: SITE, frameId: 9, documentLifecycle: "prerender" }), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(bg.stored.session)), { server: SITE, token: "t", player: { id: "a", name: "adi" }, lobbyCode: "ABCDE" });

  assert.deepEqual(await bg.send({ type: "session", session: null }, { origin: SITE, frameId: 0, documentLifecycle: "active" }), { ok: true });
  assert.equal(bg.stored.session, undefined);
});
