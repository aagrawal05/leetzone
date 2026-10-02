// "/p/:name": one player's totals, their score match by match, and the matches.

import { api, explain } from "../api.js";
import { h, replace } from "../ui/dom.js";
import { lineChart } from "../ui/chart.js";
import { date, dateTime, num, ordinal, pct, plural } from "../ui/format.js";

const tile = (label, value, note) => h("div.tile", h("span.muted.small", label), h("strong", value), note && h("span.muted.small", note));

const placing = (m) => `${ordinal(m.rank)} of ${m.playerCount}`;

function history(matches) {
  if (matches.length === 0) return h("p.muted", "No finished matches yet. The chart starts with the first one.");
  if (matches.length === 1) {
    const [m] = matches;
    return h("p.muted", `One match so far: ${num(m.score)} points, ${placing(m)}, on ${date(m.endedAt)}. A second match draws the line.`);
  }
  return lineChart(matches.map((m) => ({
    value: m.score,
    label: date(m.endedAt),
    lines: [`${num(m.score)} points`, placing(m), dateTime(m.endedAt)],
  })), { caption: `Score in each of ${matches.length} matches, oldest first` });
}

function matchTable(matches) {
  if (!matches.length) return null;
  return h("section", h("h2", "matches"), h("div.table-wrap", h("table",
    h("thead", h("tr",
      h("th.left", { scope: "col" }, "when"),
      h("th", { scope: "col" }, "place"),
      h("th", { scope: "col" }, "solved"),
      h("th", { scope: "col" }, "score"),
    )),
    // Newest first here; the chart above reads left to right, oldest first.
    h("tbody", [...matches].reverse().map((m) => h("tr",
      h("td.left", dateTime(m.endedAt)),
      h("td", m.rank === 1 && m.playerCount > 1 ? h("strong", placing(m)) : placing(m)),
      h("td", `${m.solved}/${m.questionCount}`),
      h("td", num(m.score)),
    ))),
  )));
}

export function mount(root, name) {
  document.title = `${name} · leetzone`;
  replace(root, h("p.muted.reconnecting", "loading"));
  let closed = false;
  let retry = 0;

  async function load() {
    try {
      const { player, totals, matches } = await api.profile(name);
      if (closed) return;
      document.title = `${player.name} · leetzone`;
      replace(root,
        h("section",
          h("h1", player.name),
          h("p.muted.small",
            `joined ${date(player.createdAt)}`,
            player.lcUsername && [" · LeetCode ", h("a", { href: `https://leetcode.com/u/${encodeURIComponent(player.lcUsername)}/`, target: "_blank", rel: "noopener" }, player.lcUsername)],
          ),
        ),
        h("section", h("h2", "totals"), h("div.tiles",
          tile("matches", num(totals.matches), totals.matches ? `last ${date(totals.lastPlayedAt)}` : null),
          tile("wins", num(totals.wins), totals.matches ? `${pct(totals.wins / totals.matches)} of matches` : null),
          tile("total score", num(totals.totalScore)),
          tile("average", num(totals.avgScore), "per match"),
          tile("solved", num(totals.solved), plural(totals.solved, "question").replace(/^\d+ /, "")),
          tile("accuracy", pct(totals.accuracy), "of test cases"),
        )),
        h("section", h("h2", "score per match"), history(matches)),
        matchTable(matches),
      );
    } catch (err) {
      if (closed) return;
      if (err.code === "not_found") {
        return replace(root, h("section",
          h("h1", "No such player"),
          h("p.muted", "Nobody here goes by ", h("strong", name), "."),
          h("p", h("a", { href: "/leaderboard" }, "See the leaderboard")),
        ));
      }
      replace(root, h("p.muted.reconnecting", explain(err)));
      retry = setTimeout(load, 4000);
    }
  }
  load();

  return () => { closed = true; clearTimeout(retry); };
}
