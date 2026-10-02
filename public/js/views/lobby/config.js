// The match settings. One set of controls for everyone: the host edits them,
// everyone else watches them change. Controls are created once and updated in
// place, so a snapshot arriving mid-edit never steals focus or the filter text.

import { api, explain } from "../../api.js";
import { h, keyed, text } from "../../ui/dom.js";
import { minutes, plural, toast } from "../../ui/format.js";

const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const MODES = [["per_question", "per question"], ["overall", "overall"]];
const TOPICS_SHOWN = 12;
const DEBOUNCE_MS = 250;

const clamp = (x, { min, max }) => Math.min(max, Math.max(min, x));

export function create(ctx) {
  const { meta } = ctx;
  const topicsBySize = [...meta.topics].sort((a, b) => b.count - a.count);

  let config = null;
  let editable = false;
  // Edits not yet confirmed by the server. They overlay the snapshot's config
  // while the PATCH is in flight and are dropped when it lands or is refused.
  let pending = {};
  let timer = 0;
  let showAll = false;
  // The minutes field holds text the host has typed but not yet committed.
  let typing = false;

  const view = () => ({ ...config, ...pending });

  function edit(patch) {
    if (!editable) return;
    Object.assign(pending, patch);
    render();
    clearTimeout(timer);
    timer = setTimeout(send, DEBOUNCE_MS);
  }

  async function send() {
    const sent = { ...pending };
    try {
      ctx.accept(await api.config(ctx.code, sent));
    } catch (err) {
      toast(explain(err), "bad");
    }
    // Keep only what was edited again while this request was out.
    for (const key of Object.keys(sent)) if (pending[key] === sent[key]) delete pending[key];
    render();
  }

  // ---- controls ----

  const toggle = (label, onclick) => h("button.chip", { type: "button", "aria-pressed": "false", onclick }, label);

  const diffButtons = DIFFICULTIES.map((d) => h("button.chip.diff", {
    type: "button", "aria-pressed": "false", dataset: { d },
    onclick: () => {
      const now = view().difficulties;
      const next = now.includes(d) ? now.filter((x) => x !== d) : DIFFICULTIES.filter((x) => x === d || now.includes(x));
      if (next.length) edit({ difficulties: next });
      else toast("Keep at least one difficulty.");
    },
  }, d));

  const filter = h("input", { type: "search", placeholder: "filter topics", "aria-label": "filter topics", oninput: render });
  const topicList = h("div.chips", { role: "group", "aria-label": "topics" });
  const topicNote = h("span.muted.small");
  const more = h("button.quiet.small", { type: "button", onclick: () => { showAll = !showAll; render(); } });
  const clear = h("button.quiet.small", { type: "button", onclick: () => edit({ topics: [] }) }, "clear");

  const topicChip = (t) => h("button.chip", {
    type: "button", "aria-pressed": "false",
    onclick: () => {
      const now = view().topics;
      edit({ topics: now.includes(t.slug) ? now.filter((s) => s !== t.slug) : [...now, t.slug] });
    },
  }, t.name, h("span.count", t.count));

  const stepper = (label, read, write) => {
    const value = h("output", { "aria-live": "off" });
    const less = h("button", { type: "button", "aria-label": `fewer ${label}`, onclick: () => write(read() - 1) }, "−");
    const most = h("button", { type: "button", "aria-label": `more ${label}`, onclick: () => write(read() + 1) }, "+");
    return { el: h("div.stepper", { role: "group", "aria-label": label }, less, value, most), value, less, most };
  };

  const count = stepper("questions", () => view().questionCount,
    (n) => edit({ questionCount: clamp(n, meta.limits.questionCount) }));

  const modeButtons = MODES.map(([mode, label]) => toggle(label, () => {
    if (view().timerMode === mode) return;
    // The two modes allow different ranges; carry the limit over where it fits.
    edit({ timerMode: mode, timeLimitSec: clamp(view().timeLimitSec, meta.limits.timeLimitSec[mode]) });
  }));

  const limit = h("input", {
    type: "number", inputmode: "numeric", step: 1, "aria-label": "time limit in minutes",
    oninput: () => { typing = true; },
    onblur: () => { typing = false; },
    onchange: () => {
      typing = false;
      const range = meta.limits.timeLimitSec[view().timerMode];
      const sec = clamp(Math.round(Number(limit.value) || 0) * 60, range);
      limit.value = minutes(sec);
      edit({ timeLimitSec: sec });
    },
  });
  const limitNote = h("span.muted.small");

  const paid = h("input", { type: "checkbox", onchange: () => edit({ includePaid: paid.checked }) });

  const group = (label, ...children) => h("div.cfg-row", h("span.cfg-label", label), h("div.cfg-control", children));

  const el = h("div.cfg",
    group("difficulty", h("div.chips", { role: "group", "aria-label": "difficulty" }, diffButtons)),
    group("topics", h("div.row", filter, topicNote, clear), topicList, h("div", more)),
    group("questions", count.el),
    group("clock", h("div.seg", { role: "group", "aria-label": "timer mode" }, modeButtons),
      h("label.row.inline", limit, limitNote)),
    group("premium", h("label.row.inline", paid, h("span", "include LeetCode Premium problems"))),
  );

  // ---- render ----

  function render() {
    if (!config) return;
    const c = view();
    el.classList.toggle("readonly", !editable);

    diffButtons.forEach((b) => {
      b.setAttribute("aria-pressed", String(c.difficulties.includes(b.dataset.d)));
      b.disabled = !editable;
    });

    const query = filter.value.trim().toLowerCase();
    const chosen = new Set(c.topics);
    const matches = query ? topicsBySize.filter((t) => t.name.toLowerCase().includes(query) || t.slug.includes(query)) : topicsBySize;
    const shown = query || showAll ? matches : matches.filter((t, i) => i < TOPICS_SHOWN || chosen.has(t.slug));
    keyed(topicList, shown, (t) => t.slug, topicChip, (chip, t) => {
      chip.setAttribute("aria-pressed", String(chosen.has(t.slug)));
      chip.disabled = !editable;
    });
    text(topicNote, chosen.size ? `${plural(chosen.size, "topic")} selected` : "any topic");
    clear.hidden = !editable || chosen.size === 0;
    more.hidden = Boolean(query) || matches.length <= shown.length && !showAll;
    text(more, showAll ? "fewer" : `more (${matches.length - shown.length})`);
    if (query && !shown.length) topicList.replaceChildren(h("span.muted.small", "no topic matches"));

    text(count.value, c.questionCount);
    count.less.disabled = !editable || c.questionCount <= meta.limits.questionCount.min;
    count.most.disabled = !editable || c.questionCount >= meta.limits.questionCount.max;

    modeButtons.forEach((b, i) => {
      b.setAttribute("aria-pressed", String(MODES[i][0] === c.timerMode));
      b.disabled = !editable;
    });
    const range = meta.limits.timeLimitSec[c.timerMode];
    limit.min = minutes(range.min);
    limit.max = minutes(range.max);
    limit.disabled = !editable;
    // Do not fight the host's typing; the change handler normalizes on commit.
    if (!typing) limit.value = minutes(c.timeLimitSec);
    text(limitNote, c.timerMode === "per_question" ? "minutes per question" : "minutes for the whole match");

    paid.checked = c.includePaid;
    paid.disabled = !editable;
  }

  return {
    el,
    update(snapshot, canEdit) {
      config = snapshot.config;
      editable = canEdit;
      if (!editable) pending = {};
      render();
    },
    /** Send an edit still waiting out its debounce now; resolves once the server has answered. */
    flush() {
      clearTimeout(timer);
      if (Object.keys(pending).length) return send();
    },
    destroy: () => clearTimeout(timer),
  };
}
