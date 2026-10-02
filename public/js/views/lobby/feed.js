// Recent happenings, newest first, straight from snapshot.feed.

import { h, keyed, text } from "../../ui/dom.js";

const SHOWN = 8;
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

function sentence(item, names) {
  const who = names.get(item.playerId) ?? "someone";
  const q = item.questionIndex == null ? "" : ` Q${item.questionIndex + 1}`;
  switch (item.kind) {
    case "join": return `${who} joined`;
    case "leave": return `${who} left`;
    case "start": return "match started";
    case "round": return `question ${(item.questionIndex ?? 0) + 1} opened`;
    case "solve": return `${who} solved${q}${item.points == null ? "" : ` for ${item.points}`}`;
    case "attempt": return `${who} missed on${q}`;
    case "finish": return "match finished";
    default: return String(item.kind);
  }
}

export function create() {
  const list = h("ol.feed", { role: "log", "aria-live": "polite", "aria-label": "recent events" });
  const empty = h("p.muted.small", "Nothing yet.");
  const el = h("div", list, empty);

  function update(snapshot) {
    const names = new Map(snapshot.players.map((p) => [p.id, p.name]));
    const items = [...snapshot.feed].sort((a, b) => b.id - a.id).slice(0, SHOWN);
    empty.hidden = items.length > 0;
    keyed(list, items, (item) => item.id, () => h("li", h("time.muted"), h("span")), (li, item) => {
      li.dataset.kind = item.kind;
      text(li.children[0], TIME.format(item.at));
      text(li.children[1], sentence(item, names));
    });
  }

  return { el, update };
}
