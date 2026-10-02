// "/l/:code": one view, four phases. Every snapshot, from the socket or from a
// command's response, goes through live.accept() and comes back out as a render.

import { api, explain } from "../api.js";
import * as session from "../session.js";
import { connect } from "../live.js";
import { h, replace } from "../ui/dom.js";
import { toast } from "../ui/format.js";
import { cleanCode } from "./home.js";
import * as waiting from "./lobby/waiting.js";
import * as match from "./lobby/match.js";
import * as finished from "./lobby/finished.js";

// countdown and running share a component, so the scoreboard survives the
// switch between rounds.
const COMPONENT = { lobby: waiting, countdown: match, running: match, finished };

export function mount(root, rawCode) {
  const code = cleanCode(rawCode);
  document.title = `${code} · leetzone`;
  if (code.length !== 5) return missing(root, rawCode);

  const status = h("p.muted.small.reconnecting", { role: "status" }, "connecting");
  const stage = h("div.stage");
  replace(root, status, stage);

  let meta = null;
  let snapshot = null;
  let current = null;
  let currentModule = null;
  let closed = false;
  let metaTimer = 0;

  const ctx = {
    code,
    get meta() { return meta; },
    now: () => live.now(),
    accept: (s) => live.accept(s),
    /** Run a command; its snapshot is rendered like any other. */
    async act(command) {
      try {
        live.accept(await command());
      } catch (err) {
        toast(explain(err), "bad");
      }
    },
  };

  function render() {
    if (closed || !meta || !snapshot) return;
    const module = COMPONENT[snapshot.phase];
    if (module !== currentModule) {
      current?.destroy?.();
      currentModule = module;
      current = module.create(ctx);
      replace(stage, current.el);
    }
    stage.dataset.phase = snapshot.phase;
    current.update(snapshot);

    // The extension follows whichever lobby this player is in.
    const me = session.player();
    const inIt = snapshot.players.some((p) => p.id === me?.id && !p.left);
    if (inIt) session.setLobby(code);
    else if (session.currentLobby() === code) session.setLobby(null);
  }

  const live = connect(code, {
    onSnapshot(next) { snapshot = next; render(); },
    onStatus(state) {
      if (state === "missing") return missing(root, code);
      status.hidden = state === "live";
      status.textContent = state === "connecting" ? "connecting" : "reconnecting";
    },
  });

  // The form cannot draw without the topic list and limits; keep asking.
  (async function loadMeta() {
    try {
      meta = await api.meta();
      render();
    } catch {
      if (!closed) metaTimer = setTimeout(loadMeta, 3000);
    }
  })();

  // The extension announcing itself changes the "not detected" notices.
  const off = session.onChange((what) => { if (what === "extension") render(); });

  return () => {
    closed = true;
    clearTimeout(metaTimer);
    off();
    live.close();
    current?.destroy?.();
  };
}

function missing(root, code) {
  if (session.currentLobby() === cleanCode(code)) session.setLobby(null);
  replace(root, h("section",
    h("h1", "No such lobby"),
    h("p.muted", "There is no lobby with the code ", h("strong", code), ". Codes are 5 characters; check it with whoever sent it."),
    h("p", h("a", { href: "/" }, "Create or join a lobby")),
  ));
}
