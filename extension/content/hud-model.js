// Isolated world, leetcode.com. Pure: turns a LobbySnapshot into what the HUD
// shows for one player on one tab. No DOM, no chrome.*, so `node --test` covers it.
"use strict";

const HUD_BOARD_TOP = 5;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pageSlug(pathname) {
  const m = /^\/problems\/([a-z0-9][a-z0-9_-]*)(?:\/|$)/i.exec(pathname);
  return m ? m[1].toLowerCase() : null;
}

// Equal score, solved and total solve time share a rank (DESIGN.md "Scoring").
function rankPlayers(players) {
  const time = (p) => (p.results ?? []).reduce((sum, r) => sum + (r.solved ? r.timeMs ?? 0 : 0), 0);
  let prev = null;
  return players.map((p, i) => {
    const key = `${p.score}|${p.solved}|${time(p)}`;
    const rank = prev && prev.key === key ? prev.rank : i + 1;
    prev = { key, rank };
    return rank;
  });
}

// `now` is server time: the caller corrects its own clock by the snapshot offset.
function hudModel(snapshot, playerId, slug, now) {
  const { phase, players, questions } = snapshot;
  const meIndex = players.findIndex((p) => p.id === playerId);
  const me = meIndex >= 0 ? players[meIndex] : null;
  const ranks = phase === "lobby" ? [] : rankPlayers(players);
  const model = {
    phase,
    code: snapshot.code,
    playerCount: players.length,
    round: snapshot.round + 1,
    questionCount: snapshot.questionCount,
    perQuestion: snapshot.config.timerMode === "per_question",
    endsAt: snapshot.phaseEndsAt,
    totalMs: 0,
    questions: [],
    nudge: null,
    allSolved: false,
    me: me ? { rank: ranks[meIndex] ?? null, score: me.score, solved: me.solved } : null,
    board: [],
  };

  if (phase === "countdown") model.totalMs = 5000;

  if (phase === "running") {
    // `results` lines up with `questions` by position, not by `index`.
    const open = questions.map((q, at) => ({ q, at })).filter(({ q }) => q.openedAt <= now && now < q.closesAt && SLUG_RE.test(q.slug));
    model.questions = open.map(({ q, at }) => {
      const result = me?.results?.[at] ?? null;
      return {
        index: q.index,
        label: `Q${q.index + 1}`,
        title: q.title,
        difficulty: q.difficulty,
        slug: q.slug,
        here: q.slug === slug,
        solved: !!result?.solved,
        points: result?.points ?? 0,
        attempts: result?.submissions ?? 0,
      };
    });
    if (open.length) model.totalMs = open[0].q.closesAt - open[0].q.openedAt;
    const unsolved = model.questions.filter((q) => !q.solved);
    model.allSolved = model.questions.length > 0 && unsolved.length === 0;
    // Point at the next thing worth doing, unless the tab is already on it.
    const onOpen = model.questions.some((q) => q.here && !q.solved);
    if (!onOpen && unsolved.length) model.nudge = { label: unsolved[0].label, slug: unsolved[0].slug, lost: !model.questions.some((q) => q.here) };
  }

  if (phase !== "lobby") {
    const rows = players.map((p, i) => ({
      rank: ranks[i],
      name: p.name,
      score: p.score,
      solved: p.solved,
      me: p.id === playerId,
      left: !!p.left,
      gap: false,
    }));
    model.board = rows.slice(0, HUD_BOARD_TOP);
    if (meIndex >= HUD_BOARD_TOP) model.board.push({ ...rows[meIndex], gap: meIndex > HUD_BOARD_TOP });
  }
  return model;
}

// What to flash after our own report came back with a fresh snapshot.
function flashFor(report, before, after, playerId) {
  const points = (snap) => {
    const at = snap?.questions.findIndex((q) => q.slug === report.slug) ?? -1;
    const result = snap?.players.find((p) => p.id === playerId)?.results?.[at];
    return result?.points ?? 0;
  };
  if (report.statusCode === 10) {
    // The question's points, as its row shows them; nothing if it did not count.
    const counted = points(after) > points(before);
    return { good: true, text: counted ? `Accepted · +${points(after)}` : "Accepted" };
  }
  const counts = report.totalTestcases ? ` · ${report.totalCorrect ?? 0}/${report.totalTestcases}` : "";
  return { good: false, text: (report.statusMsg || "Not accepted") + counts };
}
