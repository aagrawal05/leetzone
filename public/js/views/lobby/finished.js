// Phase "finished": the podium, the final table, and where every point came from.

import { api } from "../../api.js";
import * as session from "../../session.js";
import { h, replace, text } from "../../ui/dom.js";
import { elapsed, num, ordinal, pct, plural } from "../../ui/format.js";
import * as scoreboard from "./scoreboard.js";

function podium(players, rank) {
  return h("ol.podium", players.slice(0, 3).map((p, i) => h("li", { dataset: { place: rank[i] } },
    h("span.place", ordinal(rank[i])),
    h("a.pname", { href: `/p/${encodeURIComponent(p.name)}` }, p.name),
    h("strong", num(p.score)),
    h("span.muted.small", `${p.solved} solved`),
  )));
}

function breakdown(snapshot, q) {
  const rows = snapshot.players
    .map((p) => ({ p, r: p.results[q.index] }))
    .filter(({ r }) => r)
    .sort((a, b) => b.r.points - a.r.points);
  return h("details.breakdown", { open: snapshot.questions.length <= 3 },
    h("summary",
      h("span.muted", `Q${q.index + 1}`), " ",
      h("a", { href: q.url, target: "_blank", rel: "noopener" }, q.title), " ",
      h("span.diff", { dataset: { d: q.difficulty } }, q.difficulty),
    ),
    h("div.table-wrap", h("table",
      h("thead", h("tr",
        h("th.left", { scope: "col" }, "player"),
        h("th", { scope: "col" }, "time"),
        h("th", { scope: "col" }, "attempts"),
        h("th", { scope: "col" }, "tests"),
        h("th", { scope: "col", title: "accuracy + speed − penalty" }, "acc + spd − pen"),
        h("th", { scope: "col" }, "points"),
      )),
      h("tbody", rows.map(({ p, r }) => h("tr",
        h("td.left.name", p.name),
        h("td", r.solved ? elapsed(r.timeMs) : "–"),
        h("td", r.submissions),
        h("td", r.submissions ? pct(r.accuracy) : "–"),
        h("td.muted", `${r.breakdown.accuracy} + ${r.breakdown.speed} − ${r.breakdown.penalty}`),
        h("td", h("strong", r.points)),
      ))),
    )),
  );
}

export function create(ctx) {
  const title = h("h1", "Final standings");
  const summary = h("p.muted");
  const top = h("div");
  const board = scoreboard.create();
  const detail = h("div.stack");
  let shownMatch = null;

  const again = h("button.primary", { type: "button", onclick: () => ctx.act(() => api.reset(ctx.code)) }, "play again");
  const leave = h("button.quiet", { type: "button", onclick: () => ctx.act(() => api.leave(ctx.code)) }, "leave");
  const wait = h("span.muted.small");

  const el = h("div.phase",
    h("section", title, summary, top),
    h("section", h("h2", "standings"), board.el),
    h("section", h("h2", "question by question"), detail),
    h("section", h("div.row", again, wait, leave), h("p.small", h("a", { href: "/leaderboard" }, "all-time leaderboard"))),
  );

  function update(snapshot) {
    const me = session.player();
    const mine = snapshot.players.find((p) => p.id === me?.id);
    const rank = scoreboard.ranks(snapshot.players);
    const took = snapshot.startedAt && snapshot.endedAt ? `, ${elapsed(snapshot.endedAt - snapshot.startedAt)} played` : "";
    text(summary, `${plural(snapshot.players.length, "player")}, ${plural(snapshot.questions.length, "question")}${took}`);

    // Results cannot change once finished; rebuild the static parts only when
    // a different match is shown, so open <details> stay open across snapshots.
    if (shownMatch !== snapshot.matchId) {
      shownMatch = snapshot.matchId;
      replace(top, podium(snapshot.players, rank));
      replace(detail, snapshot.questions.map((q) => breakdown(snapshot, q)));
    }
    board.update(snapshot, me?.id);

    const host = me?.id === snapshot.hostId;
    again.hidden = !host;
    leave.hidden = !mine || mine.left;
    const hostName = snapshot.players.find((p) => p.id === snapshot.hostId)?.name ?? "The host";
    text(wait, host || !mine ? "" : `${hostName} can start another match.`);
  }

  return { el, update };
}
