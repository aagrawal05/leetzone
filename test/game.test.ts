// Whole matches, start to finish. Rule violations are in game-rules.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as game from "../src/game.ts";
import { matchRecord } from "../src/snapshot.ts";
import { ALICE, BOB, CATALOG, COUNTDOWN, T0, deps, errorCode, lobby, report, running, wrong } from "./fixtures.ts";

const OPEN = T0 + COUNTDOWN;
const view = (s: game.LobbyState, now: number) => game.snapshot(s, now, CATALOG);

test("per_question: a full two-player match", () => {
  let s = lobby({ questionCount: 2, timeLimitSec: 600 });
  s = game.start(s, ALICE.id, T0, deps());
  assert.equal(s.phase, "countdown");
  assert.equal(s.phaseEndsAt, OPEN);
  assert.equal(game.nextAlarmAt(s), OPEN);
  assert.equal(view(s, T0).questions.length, 0, "nothing revealed during the countdown");
  assert.equal(view(s, T0).questionCount, 2);

  assert.equal(game.tick(s, OPEN - 1), s, "too early: unchanged");
  s = game.tick(s, OPEN);
  assert.equal(s.phase, "running");
  assert.equal(s.phaseEndsAt, OPEN + 600_000);
  assert.deepEqual(view(s, OPEN).questions.map((q) => [q.slug, q.index, q.openedAt, q.closesAt, q.url]), [
    ["p1", 0, OPEN, OPEN + 600_000, "https://leetcode.com/problems/p1/"],
  ]);

  // Round 1 (Easy, base 100): alice wrong then right, bob right later.
  s = game.submit(s, ALICE.id, wrong("p1", 5), OPEN + 10_000);
  assert.deepEqual(s.players[0]!.results[0], {
    solved: false, timeMs: null, submissions: 1, wrong: 1, accuracy: 0.5, points: 20,
    breakdown: { accuracy: 25, speed: 0, penalty: 5 },
  });
  s = game.submit(s, ALICE.id, report("p1"), OPEN + 60_000);
  assert.deepEqual(s.players[0]!.results[0], {
    solved: true, timeMs: 60_000, submissions: 2, wrong: 1, accuracy: 1, points: 90,
    breakdown: { accuracy: 50, speed: 45, penalty: 5 },
  });
  assert.equal(s.phase, "running", "bob has not solved it yet");

  s = game.submit(s, BOB.id, report("p1"), OPEN + 300_000);
  assert.equal(s.players[1]!.results[0]!.points, 75);
  assert.equal(s.phase, "countdown", "everyone solved: the round ends early");
  assert.equal(s.round, 1);
  assert.equal(s.phaseEndsAt, OPEN + 300_000 + COUNTDOWN);
  assert.equal(s.questions[0]!.closesAt, OPEN + 300_000);
  assert.equal(view(s, OPEN + 300_001).questions.length, 1, "the next question stays hidden");

  // Round 2 (Medium, base 200): one wrong attempt, then the clock runs out.
  const open2 = OPEN + 300_000 + COUNTDOWN;
  s = game.tick(s, open2);
  assert.equal(s.phase, "running");
  assert.equal(view(s, open2).questions[1]!.slug, "p2");
  s = game.submit(s, ALICE.id, wrong("p2", 3), open2 + 1_000);
  assert.equal(s.players[0]!.results[1]!.points, 20);
  assert.equal(game.tick(s, open2 + 599_999), s);
  s = game.tick(s, open2 + 600_000);
  assert.equal(s.phase, "finished");
  assert.equal(s.endedAt, open2 + 600_000);
  assert.equal(s.phaseEndsAt, null);
  assert.equal(game.nextAlarmAt(s), null);

  const final = view(s, s.endedAt!);
  assert.deepEqual(final.players.map((p) => [p.name, p.score, p.solved]), [["alice", 110, 1], ["bob", 75, 1]]);
  assert.deepEqual(final.feed.map((f) => f.kind), ["join", "join", "start", "round", "attempt", "solve", "solve", "round", "attempt", "finish"]);
  assert.deepEqual(final.feed.map((f) => f.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const record = matchRecord(s)!;
  assert.equal(record.matchId, "match-1");
  assert.deepEqual(record.players.map((p) => [p.playerId, p.rank, p.score, p.submissions]), [["a", 1, 110, 3], ["b", 2, 75, 1]]);
  assert.deepEqual(record.players[0]!.results.map((r) => [r.questionIndex, r.slug, r.difficulty, r.points]), [
    [0, "p1", "Easy", 90],
    [1, "p2", "Medium", 20],
  ]);
});

test("overall: every question opens at once and the match ends when all are solved", () => {
  let s = running({ timerMode: "overall", timeLimitSec: 1800, questionCount: 2 });
  assert.equal(s.round, 0);
  assert.deepEqual(s.questions.map((q) => [q.openedAt, q.closesAt]), [[OPEN, OPEN + 1_800_000], [OPEN, OPEN + 1_800_000]]);
  assert.equal(view(s, OPEN).questions.length, 2);

  s = game.submit(s, ALICE.id, report("p2"), OPEN + 900_000);
  // Medium at half time: 100 + 50. limitMs is the whole match.
  assert.equal(s.players[0]!.results[1]!.points, 150);
  s = game.submit(s, ALICE.id, report("p1"), OPEN + 900_001);
  s = game.submit(s, BOB.id, report("p1"), OPEN + 900_002);
  assert.equal(s.phase, "running", "bob still has one to go");
  s = game.submit(s, BOB.id, report("p2"), OPEN + 1_000_000);
  assert.equal(s.phase, "finished");
  assert.equal(s.endedAt, OPEN + 1_000_000);
  assert.deepEqual(s.questions.map((q) => q.closesAt), [OPEN + 1_000_000, OPEN + 1_000_000]);
});

test("overall: the deadline ends the match", () => {
  let s = running({ timerMode: "overall", timeLimitSec: 1800, questionCount: 2 });
  s = game.submit(s, ALICE.id, report("p1"), OPEN + 1);
  s = game.tick(s, OPEN + 1_800_000);
  assert.equal(s.phase, "finished");
  assert.equal(s.endedAt, OPEN + 1_800_000);
  assert.equal(errorCode(() => game.submit(s, BOB.id, report("p2"), OPEN + 1_800_001)), "question_closed");
});

test("alarms: late, duplicate, and several deadlines behind", () => {
  const started = game.start(lobby({ questionCount: 2, timeLimitSec: 60 }), ALICE.id, T0, deps());

  // Late by 3 s: the round still opened on schedule.
  let s = game.tick(started, OPEN + 3_000);
  assert.equal(s.questions[0]!.openedAt, OPEN);
  assert.equal(s.phaseEndsAt, OPEN + 60_000);
  // Fired again: nothing happens, same object back.
  assert.equal(game.tick(s, OPEN + 3_000), s);
  assert.equal(game.tick(s, OPEN + 3_001), s);

  // A very late alarm walks through everything that was due.
  const round2 = OPEN + 60_000 + COUNTDOWN;
  s = game.tick(started, round2 + 10);
  assert.equal(s.phase, "running");
  assert.equal(s.round, 1);
  assert.deepEqual(s.questions.map((q) => [q.openedAt, q.closesAt]), [[OPEN, OPEN + 60_000], [round2, round2 + 60_000]]);
  assert.equal(s.version, started.version + 1, "one change, one version");

  s = game.tick(started, T0 + 10 * 60_000);
  assert.equal(s.phase, "finished");
  assert.equal(s.endedAt, round2 + 60_000);
  assert.equal(game.tick(s, T0 + 20 * 60_000), s);
  assert.equal(matchRecord(s), null, "nobody submitted: not recorded");

  const waiting = lobby();
  assert.equal(game.nextAlarmAt(waiting), null);
  assert.equal(game.tick(waiting, T0 + 1e9), waiting);
});

test("a repeated submissionId changes nothing", () => {
  let s = running();
  const miss = wrong("p1", 5);
  s = game.submit(s, ALICE.id, miss, OPEN + 1_000);
  assert.equal(game.submit(s, ALICE.id, miss, OPEN + 2_000), s);
  assert.equal(game.submit(s, ALICE.id, { ...miss, submissionId: Number(miss.submissionId) }, OPEN + 2_000), s);
  assert.equal(s.players[0]!.results[0]!.wrong, 1);

  const hit = report("p1");
  s = game.submit(s, ALICE.id, hit, OPEN + 3_000);
  s = game.submit(s, BOB.id, report("p1"), OPEN + 4_000);
  assert.equal(s.phase, "countdown");
  assert.equal(game.submit(s, ALICE.id, hit, OPEN + 5_000), s, "a retry after the round closed is not an error");
});

test("submissions after solving are ignored", () => {
  let s = running();
  s = game.submit(s, ALICE.id, report("p1"), OPEN + 1_000);
  assert.equal(game.submit(s, ALICE.id, wrong("p1", 0), OPEN + 2_000), s);
  assert.equal(game.submit(s, ALICE.id, report("p1"), OPEN + 3_000), s);
  assert.equal(s.players[0]!.results[0]!.submissions, 1);
});

test("accuracy keeps the best; no test counts is zero", () => {
  let s = running();
  s = game.submit(s, ALICE.id, wrong("p1", 7), OPEN + 1);
  s = game.submit(s, ALICE.id, wrong("p1", 2), OPEN + 2);
  s = game.submit(s, ALICE.id, report("p1", { statusCode: 20, statusMsg: "Compile Error", totalCorrect: null, totalTestcases: null }), OPEN + 3);
  s = game.submit(s, ALICE.id, wrong("p1", 3, { totalTestcases: 0 }), OPEN + 4);
  const r = s.players[0]!.results[0]!;
  assert.deepEqual([r.accuracy, r.submissions, r.wrong, r.solved], [0.7, 4, 4, false]);
  assert.equal(r.points, 15); // 35 - 20

  s = game.submit(s, BOB.id, report("p1", { totalCorrect: null, totalTestcases: null }), OPEN + 5);
  assert.equal(s.players[1]!.results[0]!.accuracy, 1, "accepted is 1 whatever the counts");
});

test("the host can end a match early; scores stand", () => {
  let s = running({ questionCount: 3 });
  s = game.submit(s, BOB.id, report("p1"), OPEN + 1_000);
  s = game.end(s, ALICE.id, OPEN + 2_000);
  assert.equal(s.phase, "finished");
  assert.equal(s.endedAt, OPEN + 2_000);
  assert.equal(s.questions[0]!.closesAt, OPEN + 2_000);
  const final = view(s, OPEN + 2_000);
  assert.equal(final.questions.length, 1, "unopened questions are never revealed");
  assert.equal(final.questionCount, 3);
  assert.equal(final.players[0]!.name, "bob");
  assert.equal(final.players[0]!.results.length, 1);
  assert.equal(matchRecord(s)!.players[0]!.results.length, 1);

  const early = game.end(game.start(lobby(), ALICE.id, T0, deps()), ALICE.id, T0 + 1);
  assert.equal(early.phase, "finished", "ending during the countdown works too");
  assert.equal(view(early, T0 + 1).questions.length, 0);
});

test("reset keeps players and config, and never repeats a question", () => {
  const config = { questionCount: 4, difficulties: ["Easy" as const], includePaid: false };
  let s = game.start(lobby(config), ALICE.id, T0, deps());
  assert.deepEqual(s.questions.map((q) => q.slug), ["p1", "p4", "p7", "p10"]);
  assert.equal(view(s, T0).poolSize, 0, "the pool shrinks by what was drawn");
  s = game.end(s, ALICE.id, T0 + 1);
  s = game.reset(s, ALICE.id, T0 + 2);

  assert.equal(s.phase, "lobby");
  assert.deepEqual(s.players.map((p) => [p.id, p.results.length]), [["a", 0], ["b", 0]]);
  assert.deepEqual(s.config.difficulties, ["Easy"]);
  assert.deepEqual([s.matchId, s.questions.length, s.round, s.startedAt, s.endedAt, s.phaseEndsAt], [null, 0, 0, null, null, null]);
  assert.deepEqual(s.playedSlugs, ["p1", "p4", "p7", "p10"]);
  assert.deepEqual(s.feed, [], "the last match's events do not follow into the next");
  assert.equal(errorCode(() => game.start(s, ALICE.id, T0 + 3, deps())), "not_enough_questions");

  s = game.configure(s, ALICE.id, { difficulties: ["Easy", "Medium"] }, T0 + 4, CATALOG);
  assert.equal(view(s, T0 + 4).poolSize, 4);
  s = game.start(s, ALICE.id, T0 + 5, deps({ matchId: "match-2" }));
  assert.deepEqual(s.questions.map((q) => q.slug), ["p2", "p5", "p8", "p11"]);
  assert.equal(s.matchId, "match-2");
  assert.deepEqual(s.feed.map((f) => [f.id, f.kind]), [[5, "start"]], "feed ids keep increasing across matches");
  assert.deepEqual(s.seenSubmissions, []);
});
