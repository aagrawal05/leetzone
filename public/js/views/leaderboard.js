// "/leaderboard": the all-time table. Click a header to sort by it; the bar
// beside each name follows the sorted column.

import { api, explain } from "../api.js";
import * as session from "../session.js";
import { h, replace } from "../ui/dom.js";
import { bar } from "../ui/chart.js";
import { num, pct } from "../ui/format.js";

const COLUMNS = [
  { key: "name", label: "player", left: true, text: true },
  { key: "matches", label: "matches", show: num },
  { key: "wins", label: "wins", show: num },
  { key: "totalScore", label: "total", show: num },
  { key: "avgScore", label: "avg", show: num },
  { key: "solved", label: "solved", show: num },
  { key: "accuracy", label: "accuracy", show: pct },
];

export function mount(root) {
  document.title = "leaderboard · leetzone";
  const body = h("div", h("p.muted.reconnecting", "loading"));
  replace(root, h("section", h("h1", "Leaderboard"), h("p.muted", "Every finished match, all time."), body));

  let rows = [];
  let sort = { key: "totalScore", dir: -1 };
  let closed = false;
  let retry = 0;

  function table() {
    const column = COLUMNS.find((c) => c.key === sort.key);
    const sorted = [...rows].sort((a, b) => {
      const order = column.text ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a[sort.key] - b[sort.key];
      return order * sort.dir || b.totalScore - a.totalScore || a.name.localeCompare(b.name);
    });
    // The bar shows the sorted measure; sorted by name, it falls back to total.
    const measure = column.text ? "totalScore" : sort.key;
    const max = Math.max(...rows.map((r) => r[measure]), 0) || 1;
    const me = session.player()?.id;

    replace(body, h("div.table-wrap", h("table.board",
      h("caption.sr", `All-time leaderboard, sorted by ${column.label}, ${sort.dir < 0 ? "descending" : "ascending"}`),
      h("thead", h("tr",
        h("th", { scope: "col" }, "#"),
        COLUMNS.map((c) => h(c.left ? "th.left" : "th", {
          scope: "col",
          "aria-sort": c.key === sort.key ? (sort.dir < 0 ? "descending" : "ascending") : null,
        }, h("button", {
          type: "button",
          dataset: { sort: c.key },
          onclick: () => {
            // Numbers start largest first, names A to Z; a second click flips.
            sort = c.key === sort.key ? { key: c.key, dir: -sort.dir } : { key: c.key, dir: c.text ? 1 : -1 };
            table();
            body.querySelector(`[data-sort="${c.key}"]`)?.focus();
          },
        }, c.label))),
        h("th.barcol", { scope: "col" }, h("span.sr", "share of the best"), h("span", { "aria-hidden": "true" }, COLUMNS.find((c) => c.key === measure).label)),
      )),
      h("tbody", sorted.map((row, i) => h("tr", { class: row.playerId === me ? "me" : "" },
        h("td.muted", i + 1),
        COLUMNS.map((c) => c.text
          ? h("td.left.name", h("a", { href: `/p/${encodeURIComponent(row.name)}` }, row.name))
          : h("td", { class: c.key === sort.key ? "sorted" : "" }, c.show(row[c.key]))),
        h("td.barcol", bar(row[measure] / max)),
      ))),
    )));
  }

  async function load() {
    try {
      ({ rows } = await api.leaderboard());
      if (closed) return;
      if (!rows.length) return replace(body, h("p.muted", "No matches played yet. ", h("a", { href: "/" }, "Start one")));
      table();
    } catch (err) {
      if (closed) return;
      replace(body, h("p.muted.reconnecting", explain(err)));
      retry = setTimeout(load, 4000);
    }
  }
  load();

  return () => { closed = true; clearTimeout(retry); };
}
