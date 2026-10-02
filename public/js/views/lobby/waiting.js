// Phase "lobby": the code to share, who is here, the settings, and start.

import { api } from "../../api.js";
import * as session from "../../session.js";
import { h, keyed, text } from "../../ui/dom.js";
import { copy, num, plural } from "../../ui/format.js";
import { nameForm } from "../home.js";
import * as configForm from "./config.js";

export function create(ctx) {
  const config = configForm.create(ctx);

  const code = h("strong.code", { "aria-label": `lobby code ${ctx.code.split("").join(" ")}` }, ctx.code);
  const share = h("div.share",
    h("div", h("h2", "lobby code"), code),
    h("div.stack", h("p.muted.small", "Send friends the code or the link."),
      h("div.row", h("button", { type: "button", onclick: () => copy(`${location.origin}/l/${ctx.code}`, "lobby link copied") }, "copy link"))),
  );

  const playerCount = h("h2");
  const players = h("ul.players");
  const playerRow = () => h("li", h("span.dot", { "aria-hidden": "true" }), h("span.pname"), h("span.muted.small"));

  const pool = h("p.pool");
  const start = h("button.primary", { type: "button", onclick: () => ctx.act(() => api.start(ctx.code)) }, "start match");
  const reason = h("span.muted.small");
  const leave = h("button.quiet", { type: "button", onclick: () => ctx.act(() => api.leave(ctx.code)) }, "leave");
  const join = h("button.primary", { type: "button", onclick: () => ctx.act(() => api.join(ctx.code)) }, "join lobby");
  const actions = h("div.row", start, join, reason, leave);

  // A visitor with no name yet signs up right here; the view remounts on sign-in.
  const signup = session.player() ? null : h("section", nameForm("Pick a name to join this lobby."));
  const noExt = h("p.notice", "The leetzone extension isn't detected in this browser. Without it your LeetCode submissions can't be scored. Install it, then reload this page.");

  const el = h("div.phase",
    h("section", share),
    noExt,
    signup,
    h("section", playerCount, players),
    h("section", h("h2", "settings"), config.el, pool),
    h("section", actions),
  );

  function update(snapshot) {
    const me = session.player();
    const member = snapshot.players.some((p) => p.id === me?.id);
    const host = me?.id === snapshot.hostId;
    const { minPlayers, limits } = ctx.meta;
    const n = snapshot.players.length;

    noExt.hidden = Boolean(session.extensionVersion()) || !me;

    text(playerCount, `players (${n}/${limits.maxPlayers})`);
    keyed(players, snapshot.players, (p) => p.id, playerRow, (li, p) => {
      const [dot, name, marks] = li.children;
      li.classList.toggle("off", !p.connected);
      dot.title = p.connected ? "connected" : "away";
      text(name, p.name);
      text(marks, [p.id === snapshot.hostId && "host", p.id === me?.id && "you", !p.connected && "away"].filter(Boolean).join(" · "));
    });
    if (!n) players.replaceChildren(h("li.muted", "Nobody here yet. The next player to join becomes host."));

    config.update(snapshot, host);
    const short = snapshot.poolSize < snapshot.config.questionCount;
    text(pool, `${num(snapshot.poolSize)} matching ${snapshot.poolSize === 1 ? "problem" : "problems"}`);
    pool.classList.toggle("short", short);

    start.hidden = !host;
    join.hidden = member || !me;
    leave.hidden = !member;
    join.disabled = n >= limits.maxPlayers;

    let why = "";
    if (host) {
      if (n < minPlayers) why = `Need ${plural(minPlayers, "player")} to start (${n} here).`;
      else if (short) why = `Only ${plural(snapshot.poolSize, "problem")} match: loosen the filters or ask for fewer questions.`;
    } else if (member) {
      const hostName = snapshot.players.find((p) => p.id === snapshot.hostId)?.name ?? "the host";
      why = `Waiting for ${hostName} to start.`;
    } else if (me && n >= limits.maxPlayers) {
      why = "This lobby is full.";
    }
    start.disabled = Boolean(why);
    text(reason, why);
  }

  return { el, update, destroy: config.destroy };
}
