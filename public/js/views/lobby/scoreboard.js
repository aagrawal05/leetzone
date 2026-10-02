// The live scoreboard. Rows are keyed by player and reused across snapshots,
// so they can slide to a new rank and their scores can count up.

import { h, keyed, text } from "../../ui/dom.js";
import { countUp, flip, pulse } from "../../ui/motion.js";
import { elapsed, num, pct } from "../../ui/format.js";

const solveTime = (p) => p.results.reduce((sum, r) => sum + (r.solved ? r.timeMs ?? 0 : 0), 0);

/** Ranks for players already in standing order. Equal score, solved count and
 *  solve time share a rank, as DESIGN.md "Scoring" has it. */
export function ranks(players) {
  const out = [];
  players.forEach((p, i) => {
    const prev = players[i - 1];
    const tied = prev && prev.score === p.score && prev.solved === p.solved && solveTime(prev) === solveTime(p);
    out.push(tied ? out[i - 1] : i + 1);
  });
  return out;
}

/** What one player did on one question, as a glyph plus a number, and a full
 *  sentence for the tooltip and screen readers. */
export function cell(result) {
  if (!result || result.submissions === 0) return { state: "none", short: "·", long: "no submissions" };
  if (result.solved) {
    return { state: "solved", short: `✓${result.points}`, long: `solved in ${elapsed(result.timeMs)}, ${result.points} points` };
  }
  return {
    state: "tried",
    short: `✗${result.wrong}`,
    long: `${result.wrong} wrong, best ${pct(result.accuracy)} of tests, ${result.points} points`,
  };
}

export function create() {
  const head = h("div.sb-row.sb-head", { role: "row" });
  const body = h("div.sb-body", { role: "rowgroup" });
  const el = h("div.sb-wrap", h("div.sb", { role: "table", "aria-label": "scoreboard" }, h("div", { role: "rowgroup" }, head), body));
  let columns = -1;
  let lastFeed = null;

  function row() {
    const score = h("span.sb-score", { role: "cell" });
    return h("div.sb-row", { role: "row" },
      h("span.sb-rank.muted", { role: "cell" }),
      h("span.sb-name", { role: "cell" }, h("a"), h("span.sb-marks.muted")),
      score,
      h("span.sb-solved.muted", { role: "cell" }),
    );
  }

  function update(snapshot, meId) {
    const n = snapshot.questions.length;
    if (n !== columns) {
      columns = n;
      head.replaceChildren(
        h("span.sb-rank", { role: "columnheader" }, "#"),
        h("span.sb-name", { role: "columnheader" }, "player"),
        h("span.sb-score", { role: "columnheader" }, "score"),
        h("span.sb-solved", { role: "columnheader" }, "solved"),
        ...snapshot.questions.map((q) => h("span.sb-q", { role: "columnheader", title: q.title }, `Q${q.index + 1}`)),
      );
    }

    const rank = ranks(snapshot.players);
    flip(() => body.children, () => {
      keyed(body, snapshot.players, (p) => p.id, row, (tr, p, i) => {
        const [rankEl, nameEl, scoreEl, solvedEl] = tr.children;
        tr.classList.toggle("me", p.id === meId);
        tr.classList.toggle("left", p.left);
        text(rankEl, rank[i]);
        const link = nameEl.firstElementChild;
        text(link, p.name);
        link.setAttribute("href", `/p/${encodeURIComponent(p.name)}`);
        text(nameEl.lastElementChild, [p.id === meId && "you", p.left && "left"].filter(Boolean).join(", "));
        countUp(scoreEl, p.score, num);
        text(solvedEl, `${p.solved}/${snapshot.questionCount}`);

        while (tr.children.length > 4 + n) tr.lastElementChild.remove();
        while (tr.children.length < 4 + n) tr.append(h("span.sb-q", { role: "cell" }));
        for (let q = 0; q < n; q++) {
          const c = cell(p.results[q]);
          const td = tr.children[4 + q];
          text(td, c.short);
          td.dataset.state = c.state;
          td.title = c.long;
          td.setAttribute("aria-label", c.long);
        }
      });
    });

    // Flash the rows that scored since the last snapshot. The first snapshot
    // only sets the baseline, so opening the page mid-match flashes nothing.
    const newest = snapshot.feed.reduce((max, item) => Math.max(max, item.id), 0);
    if (lastFeed !== null) {
      for (const item of snapshot.feed) {
        if (item.id <= lastFeed || item.kind !== "solve") continue;
        const tr = [...body.children].find((r) => r.dataset.key === item.playerId);
        if (tr) pulse(tr, "scored");
      }
    }
    lastFeed = newest;
  }

  return { el, update };
}
