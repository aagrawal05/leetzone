// Isolated world, leetcode.com. The HUD's DOM: built once, then updated in
// place from a hudModel(). Lives in a closed shadow root on <html>. Text only
// ever goes in through textContent.
"use strict";

function createHud({ onGo, onLayout }) {
  const FLASH_MS = 4000;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const show = (node, on) => {
    if (node.hidden === on) node.hidden = !on;
  };
  const problemUrl = (slug) => `https://leetcode.com/problems/${slug}/`;

  const host = el("leetzone-hud");
  // Inline !important beats any page rule that happens to match the host.
  host.style.cssText =
    "all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(HUD_CSS);
  root.adoptedStyleSheets = [sheet];

  const ui = {
    panel: el("div", "panel"),
    bar: el("div", "bar"),
    name: el("span", "", "LeetZone"),
    code: el("span", "code"),
    mini: el("span", "mini"),
    dot: el("span", "dot"),
    toggle: el("button", "toggle"),
    body: el("div", "body"),
    final: el("div", "final"),
    head: el("div", "head"),
    clock: el("div", "clock"),
    sub: el("div", "sub"),
    drain: el("div", "drain"),
    fill: el("div", "fill"),
    nudge: el("a", "nudge"),
    note: el("div", "note"),
    questions: el("ul", "questions"),
    me: el("div", "me"),
    rank: el("span", "rank"),
    score: el("span"),
    board: el("ol", "board"),
    site: el("a", "site", "Open the lobby page"),
    flash: el("div", "flash"),
    offline: el("div", "offline", "offline - retrying"),
  };
  ui.panel.setAttribute("role", "status");
  ui.toggle.type = "button";
  ui.dot.title = "offline";
  ui.site.target = "_blank";
  ui.site.rel = "noopener";
  ui.head.append(ui.clock, ui.sub);
  ui.drain.append(ui.fill);
  ui.me.append(ui.rank, ui.score);
  ui.bar.append(el("span", "mark", "[·]"), ui.name, ui.code, ui.mini, el("span", "grow"), ui.dot, ui.toggle);
  ui.body.append(ui.final, ui.head, ui.drain, ui.nudge, ui.note, ui.questions, ui.me, ui.board, ui.site, ui.flash, ui.offline);
  ui.panel.append(ui.bar, ui.body);
  root.append(ui.panel);
  for (const node of [ui.flash, ui.offline, ui.dot]) node.hidden = true;

  // ---- position, drag, collapse -------------------------------------------
  // `pos` is where the user put it; clamping to the viewport never overwrites it.
  let pos = null;
  let collapsed = false;
  let drag = null;

  function place() {
    const r = ui.panel.getBoundingClientRect();
    const want = pos ?? { x: innerWidth - r.width - 16, y: 64 };
    const x = Math.round(Math.max(0, Math.min(want.x, innerWidth - r.width)));
    const y = Math.round(Math.max(0, Math.min(want.y, innerHeight - r.height)));
    ui.panel.style.transform = `translate(${x}px, ${y}px)`;
    return { x, y };
  }
  function setCollapsed(on) {
    collapsed = on;
    ui.panel.classList.toggle("collapsed", on);
    show(ui.name, !on);
    setText(ui.toggle, on ? "+" : "–");
    ui.toggle.setAttribute("aria-label", on ? "Expand LeetZone" : "Collapse LeetZone");
    place();
  }
  ui.toggle.addEventListener("click", () => {
    setCollapsed(!collapsed);
    onLayout({ ...pos, collapsed });
  });
  ui.bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target === ui.toggle) return;
    ui.bar.setPointerCapture(e.pointerId);
    drag = { px: e.clientX, py: e.clientY, from: place(), moved: false };
    e.preventDefault();
  });
  ui.bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.moved = true;
    pos = { x: drag.from.x + e.clientX - drag.px, y: drag.from.y + e.clientY - drag.py };
    place();
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    pos = place();
    onLayout({ ...pos, collapsed });
  };
  ui.bar.addEventListener("pointerup", endDrag);
  ui.bar.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", place);

  // ---- links --------------------------------------------------------------
  // Problem links move this tab; the handler keeps it an in-page decision.
  function problemLink(a, slug) {
    const href = problemUrl(slug);
    if (a.href !== href) a.href = href;
    a.dataset.slug = slug;
  }
  ui.body.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[data-slug]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onGo(a.dataset.slug);
  });

  // ---- lists, reconciled by position --------------------------------------
  function resize(list, n, make) {
    while (list.children.length > n) list.lastElementChild.remove();
    while (list.children.length < n) list.append(make());
  }
  function makeQuestion() {
    const li = el("li");
    const a = el("a", "q");
    a.append(el("span", "label"), el("span", "title"), el("span", "diff"), el("span", "status"));
    li.append(a);
    return li;
  }
  function makeRow() {
    const li = el("li", "row");
    li.append(el("span"), el("span", "name"), el("span"));
    return li;
  }
  function renderQuestions(questions) {
    resize(ui.questions, questions.length, makeQuestion);
    questions.forEach((q, i) => {
      const a = ui.questions.children[i].firstElementChild;
      const [label, title, diff, status] = a.children;
      problemLink(a, q.slug);
      a.classList.toggle("here", q.here);
      a.classList.toggle("solved", q.solved);
      setText(label, q.label);
      setText(title, q.title);
      setText(diff, q.difficulty);
      diff.className = "diff " + (["Easy", "Medium", "Hard"].includes(q.difficulty) ? q.difficulty : "");
      const tries = q.attempts === 1 ? "1 attempt" : `${q.attempts} attempts`;
      setText(status, q.solved ? `solved · +${q.points}` : q.attempts ? `${tries} · ${q.points} pts` : q.here ? "you are here" : "not attempted");
    });
  }
  function renderBoard(board) {
    resize(ui.board, board.length, makeRow);
    board.forEach((p, i) => {
      const li = ui.board.children[i];
      const [rank, name, score] = li.children;
      li.className = "row" + (p.me ? " self" : "") + (p.left ? " left" : "") + (p.gap ? " gap" : "");
      setText(rank, String(p.rank));
      setText(name, p.name);
      setText(score, String(p.score));
    });
  }

  // ---- render -------------------------------------------------------------
  let phase = null;
  let total = 0;
  let lastSecond = null;
  let flashTimer = 0;

  function render(model, { lobbyUrl, offline }) {
    phase = model.phase;
    total = model.totalMs;
    ui.panel.dataset.phase = phase;
    const timed = phase === "countdown" || phase === "running";
    const running = phase === "running";
    setText(ui.code, model.code);
    show(ui.head, timed);
    show(ui.drain, running);
    show(ui.mini, timed);
    show(ui.final, !timed);
    show(ui.questions, running);
    show(ui.nudge, running && !!model.nudge);
    show(ui.me, !!model.me && (running || phase === "finished"));
    show(ui.board, model.board.length > 0 && phase !== "countdown");
    show(ui.site, !timed);
    show(ui.offline, offline);
    show(ui.dot, offline);
    if (ui.site.href !== lobbyUrl) ui.site.href = lobbyUrl;

    const people = model.playerCount === 1 ? "1 player" : `${model.playerCount} players`;
    const round = `Question ${model.round} of ${model.questionCount}`;
    setText(ui.sub, model.perQuestion || phase === "countdown" ? round : model.questionCount === 1 ? "1 question" : `${model.questionCount} questions`);
    let note = "";
    if (phase === "lobby") {
      setText(ui.final, `Lobby ${model.code}`);
      note = `waiting for host · ${people}`;
    } else if (phase === "finished") {
      setText(ui.final, model.me ? `Finished · #${model.me.rank} of ${model.playerCount}` : "Finished");
    } else if (phase === "countdown") {
      note = "";
    } else if (model.allSolved) {
      note = model.perQuestion ? "Solved. Waiting for the round to end." : "All solved. Waiting for the match to end.";
    } else if (model.questions.length === 0) {
      note = "No question is open.";
    }
    setText(ui.note, note);
    show(ui.note, !!note);

    if (model.nudge) {
      problemLink(ui.nudge, model.nudge.slug);
      setText(ui.nudge, model.nudge.lost ? `You are not on a match question → go to ${model.nudge.label}` : `Next up → go to ${model.nudge.label}`);
    }
    if (running) renderQuestions(model.questions);
    if (model.me) {
      setText(ui.rank, phase === "finished" ? "final score" : `#${model.me.rank} of ${model.playerCount}`);
      setText(ui.score, `${model.me.score} pts · ${model.me.solved} solved`);
    }
    renderBoard(model.board);
    place();
  }

  // Called a few times a second while a clock is showing.
  function tick(msLeft) {
    if (phase !== "countdown" && phase !== "running") return;
    const second = Math.max(0, Math.ceil(msLeft / 1000));
    const text = phase === "countdown" ? String(second) : formatClock(msLeft);
    setText(ui.clock, text);
    setText(ui.mini, text);
    if (phase === "countdown" && second !== lastSecond) {
      ui.clock.classList.remove("tick");
      void ui.clock.offsetWidth; // restart the animation
      ui.clock.classList.add("tick");
    }
    lastSecond = second;
    const left = total > 0 ? Math.max(0, Math.min(1, msLeft / total)) : 0;
    ui.fill.style.transform = `scaleX(${left.toFixed(4)})`;
    ui.panel.classList.toggle("urgent", phase === "running" && left < 0.1);
  }

  function flash(kind, text) {
    clearTimeout(flashTimer);
    ui.flash.hidden = true;
    void ui.flash.offsetWidth;
    ui.flash.className = "flash " + kind;
    ui.flash.textContent = text;
    ui.flash.hidden = false;
    flashTimer = setTimeout(() => {
      ui.flash.hidden = true;
      place();
    }, FLASH_MS);
    place();
  }

  return {
    host,
    render,
    tick,
    flash,
    place,
    setLayout(layout) {
      if (Number.isFinite(layout?.x) && Number.isFinite(layout?.y)) pos = { x: layout.x, y: layout.y };
      setCollapsed(!!layout?.collapsed);
    },
    destroy() {
      clearTimeout(flashTimer);
      window.removeEventListener("resize", place);
      host.remove();
    },
  };
}
