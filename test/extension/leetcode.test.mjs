// The isolated-world pieces that need no DOM: the HUD's view model
// (content/hud-model.js) and the fallback verdict poll (content/judge.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (name) => readFileSync(new URL("../../extension/content/" + name, import.meta.url), "utf8");

// Content scripts are classic scripts sharing one global scope; so is this.
function load(files, globals = {}) {
  const ctx = vm.createContext({ setTimeout, encodeURIComponent, ...globals });
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return (expr) => vm.runInContext(expr, ctx);
}
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- hud-model.js ---------------------------------------------------------

const model = load(["hud-model.js"]);
const hudModel = model("hudModel");
const NOW = 1_000_000;

const result = (over = {}) => ({
  solved: false, timeMs: null, submissions: 0, wrong: 0, accuracy: 0, points: 0,
  breakdown: { accuracy: 0, speed: 0, penalty: 0 }, ...over,
});
const question = (index, slug, over = {}) => ({
  id: String(index + 1), slug, title: slug, difficulty: "Easy", topics: [], index,
  url: `https://leetcode.com/problems/${slug}/`, openedAt: NOW - 60_000, closesAt: NOW + 240_000, ...over,
});
const player = (id, score, results, over = {}) => ({
  id, name: id, connected: true, left: false, score, solved: results.filter((r) => r.solved).length, results, ...over,
});
const snap = (over = {}) => ({
  code: "ABCDE", phase: "running", hostId: "a", poolSize: 100, matchId: "m1", questionCount: 3, round: 0,
  config: { difficulties: ["Easy"], topics: [], questionCount: 3, timerMode: "per_question", timeLimitSec: 300, includePaid: false },
  players: [], questions: [], phaseEndsAt: NOW + 240_000, startedAt: NOW - 60_000, endedAt: null, feed: [], version: 1, now: NOW,
  ...over,
});

test("formatClock and pageSlug", () => {
  const formatClock = model("formatClock");
  const pageSlug = model("pageSlug");
  assert.deepEqual([0, -5, 1, 999, 1000, 61_000, 3_600_000].map(formatClock), ["00:00", "00:00", "00:01", "00:01", "00:01", "01:01", "60:00"]);
  assert.equal(pageSlug("/problems/Two-Sum/description/"), "two-sum");
  assert.equal(pageSlug("/problems/two-sum"), "two-sum");
  assert.equal(pageSlug("/problemset/"), null);
  assert.equal(pageSlug("/contest/weekly-1/problems/two-sum/"), null);
});

test("per_question: the open question, my status, and a nudge when elsewhere", () => {
  const s = snap({
    round: 1,
    questions: [question(0, "two-sum", { openedAt: NOW - 400_000, closesAt: NOW - 100_000 }), question(1, "lru-cache", { difficulty: "Medium" })],
    players: [
      player("a", 180, [result({ solved: true, timeMs: 5000, points: 180, submissions: 1 }), result()]),
      player("b", 40, [result({ points: 40, submissions: 2, wrong: 2 }), result({ submissions: 1, wrong: 1, points: 12 })]),
    ],
  });
  const m = plain(hudModel(s, "b", "two-sum", NOW));
  assert.deepEqual(m.questions.map((q) => [q.label, q.slug, q.difficulty, q.here, q.solved, q.points, q.attempts]), [["Q2", "lru-cache", "Medium", false, false, 12, 1]]);
  assert.deepEqual(m.nudge, { label: "Q2", slug: "lru-cache", lost: true });
  assert.deepEqual(m.me, { rank: 2, score: 40, solved: 0 });
  assert.equal(m.totalMs, 300_000);
  assert.equal(m.round, 2);

  const here = plain(hudModel(s, "b", "lru-cache", NOW));
  assert.equal(here.nudge, null);
  assert.equal(here.questions[0].here, true);
});

test("overall: every question listed; nudge moves on from a solved one; none once all solved", () => {
  const qs = [question(0, "two-sum"), question(1, "lru-cache"), question(2, "3sum")];
  const overall = { ...snap().config, timerMode: "overall" };
  const mine = [result({ solved: true, timeMs: 1000, points: 90, submissions: 1 }), result(), result()];
  const s = snap({ config: overall, questions: qs, players: [player("a", 90, mine)] });
  const m = plain(hudModel(s, "a", "two-sum", NOW));
  assert.equal(m.questions.length, 3);
  assert.equal(m.perQuestion, false);
  assert.deepEqual(m.nudge, { label: "Q2", slug: "lru-cache", lost: false });

  const done = [0, 1, 2].map(() => result({ solved: true, timeMs: 1000, points: 90, submissions: 1 }));
  const all = plain(hudModel(snap({ config: overall, questions: qs, players: [player("a", 270, done)] }), "a", "problemset", NOW));
  assert.equal(all.nudge, null);
  assert.equal(all.allSolved, true);
});

test("a question with an unsafe slug is never linked", () => {
  const s = snap({ questions: [question(0, "../../evil")], players: [player("a", 0, [result()])] });
  assert.deepEqual(plain(hudModel(s, "a", null, NOW)).questions, []);
});

test("scoreboard: top five plus me, shared ranks, left players marked", () => {
  const solved = (ms) => [result({ solved: true, timeMs: ms, points: 100, submissions: 1 })];
  const players = [
    player("p1", 100, solved(5000)),
    player("p2", 100, solved(5000)),
    player("p3", 100, solved(9000), { left: true }),
    player("p4", 50, [result()]),
    player("p5", 40, [result()]),
    player("p6", 30, [result()]),
    player("p7", 20, [result()]),
    player("p8", 10, [result()]),
  ];
  const s = snap({ questions: [question(0, "two-sum")], players });
  const m = plain(hudModel(s, "p8", "two-sum", NOW));
  assert.deepEqual(m.board.map((r) => [r.rank, r.name, r.me, r.gap]), [
    [1, "p1", false, false], [1, "p2", false, false], [3, "p3", false, false], [4, "p4", false, false], [5, "p5", false, false],
    [8, "p8", true, true],
  ]);
  assert.equal(m.board[2].left, true);
  assert.equal(plain(hudModel(s, "p6", "two-sum", NOW)).board.at(-1).gap, false, "sixth place follows on directly");
  assert.equal(plain(hudModel(s, "p2", "two-sum", NOW)).board.length, 5);
  assert.equal(plain(hudModel(s, "nobody", "two-sum", NOW)).me, null);
});

test("lobby, countdown and finished carry no questions", () => {
  const players = [player("a", 0, []), player("b", 0, [])];
  const lobby = plain(hudModel(snap({ phase: "lobby", players, phaseEndsAt: null }), "a", null, NOW));
  assert.deepEqual([lobby.playerCount, lobby.board, lobby.questions, lobby.nudge], [2, [], [], null]);
  const countdown = plain(hudModel(snap({ phase: "countdown", players, round: 1, phaseEndsAt: NOW + 5000 }), "a", null, NOW));
  assert.deepEqual([countdown.round, countdown.questionCount, countdown.totalMs, countdown.questions], [2, 3, 5000, []]);
  const finished = plain(hudModel(snap({ phase: "finished", players: [player("b", 9, []), player("a", 3, [])], phaseEndsAt: null }), "a", null, NOW));
  assert.deepEqual(finished.me, { rank: 2, score: 3, solved: 0 });
});

test("flashFor: the question's points on a counted accept, status and counts otherwise", () => {
  const flashFor = model("flashFor");
  const q = [question(0, "two-sum")];
  const before = snap({ questions: q, players: [player("a", 20, [result({ points: 20 })])] });
  const after = snap({ questions: q, players: [player("a", 170, [result({ solved: true, points: 170 })])] });
  const ok = { slug: "two-sum", statusCode: 10, statusMsg: "Accepted", totalCorrect: 5, totalTestcases: 5 };
  assert.deepEqual(plain(flashFor(ok, before, after, "a")), { good: true, text: "Accepted · +170" });
  assert.deepEqual(plain(flashFor(ok, null, after, "a")), { good: true, text: "Accepted · +170" });
  assert.deepEqual(plain(flashFor(ok, after, after, "a")), { good: true, text: "Accepted" });
  const wa = { slug: "two-sum", statusCode: 11, statusMsg: "Wrong Answer", totalCorrect: 3, totalTestcases: 5 };
  assert.deepEqual(plain(flashFor(wa, before, before, "a")), { good: false, text: "Wrong Answer · 3/5" });
  const ce = { slug: "two-sum", statusCode: 20, statusMsg: "Compile Error", totalCorrect: null, totalTestcases: null };
  assert.deepEqual(plain(flashFor(ce, before, before, "a")), { good: false, text: "Compile Error" });
});

// ---- judge.js -------------------------------------------------------------

function judge(route) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const r = route(url, calls.length);
    if (r === "throw") throw new TypeError("Failed to fetch");
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body };
  };
  return { calls, run: load(["judge.js"], { fetch, document: { cookie: "a=1; csrftoken=TOK" } }) };
}
const FINAL = { state: "SUCCESS", status_code: 10, status_msg: "Accepted", total_correct: 5, total_testcases: 5, compare_result: "11111", lang: "cpp" };

test("readVerdict follows the hook's rules", () => {
  const readVerdict = judge(() => ({})).run("readVerdict");
  assert.equal(readVerdict({ state: "PENDING" }), null);
  assert.equal(readVerdict({ ...FINAL, ai_state: "STARTED" }), null);
  assert.deepEqual(plain(readVerdict({ state: "FAILURE" })), { failed: true });
  assert.deepEqual(plain(readVerdict({ ...FINAL, ai_state: "SUCCESS" })).final, { statusCode: 10, statusMsg: "Accepted", totalCorrect: 5, totalTestcases: 5, lang: "cpp" });
  assert.deepEqual(plain(readVerdict({ ...FINAL, compare_result: "11011", total_correct: 4 })).final, { statusCode: 11, statusMsg: "Wrong Answer", totalCorrect: 4, totalTestcases: 5, lang: "cpp" });
  const ce = { state: "SUCCESS", status_code: 20, status_msg: "Compile Error", total_correct: null, total_testcases: null, compare_result: "" };
  assert.deepEqual(plain(readVerdict(ce, "rust")).final, { statusCode: 20, statusMsg: "Compile Error", totalCorrect: null, totalTestcases: null, lang: "rust" });
});

test("pollVerdict: polls v2 until final", async () => {
  const j = judge((url, n) => ({ body: n < 3 ? { state: "PENDING" } : n === 3 ? { ...FINAL, ai_state: "PENDING" } : FINAL }));
  const v = await j.run("pollVerdict")("42", "cpp", () => false, 5000, 1);
  assert.equal(v.statusCode, 10);
  assert.deepEqual(j.calls, Array(4).fill("/submissions/detail/42/v2/check/"));
});

test("pollVerdict: falls back to the legacy URL when v2 is gone", async () => {
  const j = judge((url) => (url.includes("/v2/") ? { status: 404 } : { body: FINAL }));
  const v = await j.run("pollVerdict")("43", null, () => false, 5000, 1);
  assert.equal(v.statusCode, 10);
  assert.deepEqual(j.calls, ["/submissions/detail/43/v2/check/", "/submissions/detail/43/check/"]);
});

test("pollVerdict: always gives up - forever PENDING, repeated failures, judge failure, cancellation", async () => {
  let j = judge(() => ({ body: { state: "PENDING" } }));
  assert.equal(await j.run("pollVerdict")("44", null, () => false, 40, 5), null);
  assert.ok(j.calls.length >= 2);

  j = judge(() => "throw");
  assert.equal(await j.run("pollVerdict")("45", null, () => false, 5000, 1), null);
  assert.equal(j.calls.length, 5);

  j = judge(() => ({ body: { state: "FAILURE" } }));
  assert.equal(await j.run("pollVerdict")("46", null, () => false, 5000, 1), null);
  assert.equal(j.calls.length, 1);

  j = judge(() => ({ body: { state: "PENDING" } }));
  assert.equal(await j.run("pollVerdict")("47", null, () => j.calls.length >= 2, 5000, 1), null);
  assert.equal(j.calls.length, 2);
});

test("fetchLcUsername: signed in, signed out, broken", async () => {
  const ask = (route) => judge(route).run("fetchLcUsername")();
  assert.equal(await ask(() => ({ body: { data: { userStatus: { username: "alice", isSignedIn: true } } } })), "alice");
  assert.equal(await ask(() => ({ body: { data: { userStatus: { username: "", isSignedIn: false } } } })), null);
  assert.equal(await ask(() => "throw"), null);
});
