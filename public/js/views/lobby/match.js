// Phases "countdown" and "running". One component for both, so the scoreboard
// and feed stay put while synchronized rounds alternate with countdowns.

import { api } from "../../api.js";
import * as session from "../../session.js";
import { h, keyed, text } from "../../ui/dom.js";
import { clock, elapsed, pct, plural, unslug } from "../../ui/format.js";
import { pulse, ticker } from "../../ui/motion.js";
import * as scoreboard from "./scoreboard.js";
import * as feed from "./feed.js";

const URGENT = 0.1;

/** A sentence on where this player stands on one question. */
function status(result) {
  if (!result || result.submissions === 0) return { state: "none", line: "unsolved", detail: "" };
  const b = result.breakdown;
  const terms = `accuracy ${b.accuracy} + speed ${b.speed} − penalty ${b.penalty}`;
  if (result.solved) {
    return { state: "solved", line: `✓ solved in ${elapsed(result.timeMs)} · ${result.points} points`, detail: terms };
  }
  return {
    state: "tried",
    line: `✗ ${plural(result.submissions, "attempt")}, best ${pct(result.accuracy)} of tests · ${result.points} points`,
    detail: terms,
  };
}

export function create(ctx) {
  const topicName = new Map(ctx.meta.topics.map((t) => [t.slug, t.name]));
  let snapshot = null;

  // ---- clock ----
  const announce = h("p.announce");
  const digits = h("div.clock", { role: "timer" });
  const bar = h("div.drain", { "aria-hidden": "true" }, h("i"));
  const dots = h("ol.dots");
  const timer = h("section.timer", announce, digits, bar, dots);

  function tick() {
    if (!snapshot?.phaseEndsAt) return;
    const left = snapshot.phaseEndsAt - ctx.now();
    if (snapshot.phase === "countdown") {
      // Past zero the server is about to move on; hold on "1" rather than show 0.
      const n = String(Math.max(1, Math.ceil(left / 1000)));
      if (digits.textContent !== n) { digits.textContent = n; pulse(digits, "pop"); }
      return;
    }
    const total = snapshot.config.timeLimitSec * 1000;
    const fraction = Math.min(1, Math.max(0, left / total));
    text(digits, clock(left));
    bar.firstElementChild.style.transform = `scaleX(${fraction})`;
    timer.classList.toggle("urgent", fraction <= URGENT);
  }
  const stop = ticker(tick);

  // ---- questions ----
  const cards = h("div.cards");
  const card = () => h("article.card",
    h("div.card-head", h("span.muted.qn"), h("span.diff")),
    h("h3"),
    h("div.tags"),
    h("p.mine", h("span.mine-line"), h("span.mine-detail.muted.small")),
    h("div", h("a.out", { target: "_blank", rel: "noopener" }, "open on LeetCode ↗")),
  );

  const board = scoreboard.create();
  const events = feed.create();

  const end = h("button", { type: "button", onclick: () => confirm("End the match now for everyone?") && ctx.act(() => api.end(ctx.code)) }, "end match");
  const leave = h("button.quiet", { type: "button", onclick: () => confirm("Leave the match? You keep your score and stop holding up the round.") && ctx.act(() => api.leave(ctx.code)) }, "leave");
  // Someone who left keeps their seat and may take it back.
  const rejoin = h("button", { type: "button", onclick: () => ctx.act(() => api.join(ctx.code)) }, "rejoin");
  const noExt = h("p.notice", "The leetzone extension isn't detected, so your submissions here won't be scored. ", h("a", { href: session.EXTENSION_URL, target: "_blank", rel: "noopener" }, "Install it from the Chrome Web Store"), ".");

  const questions = h("section", h("h2"), cards);
  const el = h("div.phase",
    timer,
    noExt,
    questions,
    h("section", h("h2", "scoreboard"), board.el),
    h("section", h("h2", "recent"), events.el),
    h("section", h("div.row", end, rejoin, leave)),
  );

  function update(next) {
    snapshot = next;
    const me = session.player();
    const mine = next.players.find((p) => p.id === me?.id);
    const perQuestion = next.config.timerMode === "per_question";
    const counting = next.phase === "countdown";
    const now = ctx.now();

    timer.classList.toggle("counting", counting);
    if (counting) timer.classList.remove("urgent");
    text(announce, counting
      ? (perQuestion ? `Question ${next.round + 1} of ${next.questionCount}` : "Match starts")
      : (perQuestion ? `Question ${next.round + 1} of ${next.questionCount}` : `${plural(next.questionCount, "question")}, one clock`));
    bar.hidden = counting;

    dots.hidden = !perQuestion || next.questionCount < 2;
    keyed(dots, Array.from({ length: next.questionCount }, (_, i) => i), (i) => i, () => h("li"), (li, i) => {
      const state = i < next.round ? "done" : i === next.round ? (counting ? "next" : "open") : "todo";
      li.dataset.state = state;
      text(li, `question ${i + 1}: ${state}`);
    });

    // Only questions that are open right now get a card: earlier rounds live on
    // in the scoreboard, and a countdown shows none.
    const open = counting ? [] : next.questions.filter((q) => q.openedAt <= now && now < q.closesAt);
    questions.hidden = open.length === 0;
    text(questions.firstElementChild, open.length === 1 ? "the question" : "the questions");
    keyed(cards, open, (q) => q.index, card, (art, q) => {
      const [head, title, tags, my, links] = art.children;
      text(head.children[0], `Q${q.index + 1} · #${q.id}`);
      text(head.children[1], q.difficulty);
      head.children[1].dataset.d = q.difficulty;
      art.dataset.d = q.difficulty;
      text(title, q.title);
      keyed(tags, q.topics, (t) => t, () => h("span.tag"), (tag, t) => text(tag, topicName.get(t) ?? unslug(t)));
      const s = status(mine?.results[q.index]);
      art.dataset.state = s.state;
      text(my.children[0], mine ? s.line : "you're watching");
      text(my.children[1], mine ? s.detail : "");
      links.firstElementChild.setAttribute("href", q.url);
    });

    board.update(next, me?.id);
    events.update(next);

    noExt.hidden = Boolean(session.extensionVersion()) || !mine || mine.left;
    end.hidden = me?.id !== next.hostId;
    leave.hidden = !mine || mine.left;
    rejoin.hidden = !mine?.left;
    tick();
  }

  return { el, update, destroy: stop };
}
