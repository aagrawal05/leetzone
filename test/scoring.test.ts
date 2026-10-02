import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScoreInput } from "../src/scoring.ts";
import { BASE_POINTS, rankStandings, scoreQuestion, submissionAccuracy } from "../src/scoring.ts";

const LIMIT = 600_000;
const input = (over: Partial<ScoreInput>): ScoreInput => ({
  difficulty: "Easy",
  solved: false,
  timeMs: null,
  limitMs: LIMIT,
  accuracy: 0,
  wrong: 0,
  ...over,
});

test("base points per difficulty", () => {
  assert.deepEqual(BASE_POINTS, { Easy: 100, Medium: 200, Hard: 300 });
});

test("an instant first-try solve earns the full base", () => {
  for (const difficulty of ["Easy", "Medium", "Hard"] as const) {
    const s = scoreQuestion(input({ difficulty, solved: true, timeMs: 0, accuracy: 1 }));
    assert.equal(s.points, BASE_POINTS[difficulty]);
    assert.deepEqual(s.breakdown, { accuracy: BASE_POINTS[difficulty] / 2, speed: BASE_POINTS[difficulty] / 2, penalty: 0 });
  }
});

test("a solve at the buzzer earns half", () => {
  const s = scoreQuestion(input({ difficulty: "Medium", solved: true, timeMs: LIMIT, accuracy: 1 }));
  assert.equal(s.points, 100);
  assert.deepEqual(s.breakdown, { accuracy: 100, speed: 0, penalty: 0 });
});

test("speed is linear in time left", () => {
  const s = scoreQuestion(input({ difficulty: "Hard", solved: true, timeMs: LIMIT / 4, accuracy: 1 }));
  assert.equal(s.breakdown.speed, 113); // 0.5 * 300 * 0.75 = 112.5
  assert.equal(s.points, 263); // 150 + 112.5, rounded once
});

test("speed is clamped to 0..1", () => {
  assert.equal(scoreQuestion(input({ solved: true, timeMs: LIMIT * 3 })).breakdown.speed, 0);
  assert.equal(scoreQuestion(input({ solved: true, timeMs: -5_000 })).breakdown.speed, 50);
  assert.equal(scoreQuestion(input({ solved: true, timeMs: 10, limitMs: 0 })).breakdown.speed, 0);
});

test("no speed bonus unless solved", () => {
  const s = scoreQuestion(input({ timeMs: 0, accuracy: 0.9 }));
  assert.equal(s.breakdown.speed, 0);
  assert.equal(s.points, 45);
});

test("unsolved earns up to half of base for test cases passed", () => {
  assert.equal(scoreQuestion(input({ difficulty: "Hard", accuracy: 0.5 })).points, 75);
  assert.equal(scoreQuestion(input({ difficulty: "Hard", accuracy: 1 })).points, 150);
  assert.equal(scoreQuestion(input({ accuracy: 0 })).points, 0);
});

test("exact halves round up despite floating point", () => {
  // 0.5 * 200 * (23 / 40) - 200 * 0.05 = 47.5, but evaluates to 47.49999999999999.
  const medium = scoreQuestion(input({ difficulty: "Medium", accuracy: 23 / 40, wrong: 1 }));
  assert.equal(medium.points, 48);
  assert.deepEqual(medium.breakdown, { accuracy: 58, speed: 0, penalty: 10 });
  // 17.5 - 15 = 2.5, where 0.05 * 3 is 0.15000000000000002.
  assert.equal(scoreQuestion(input({ accuracy: 7 / 20, wrong: 3 })).points, 3);
});

test("accuracy is clamped, and is 1 once solved", () => {
  assert.equal(scoreQuestion(input({ accuracy: 7 })).breakdown.accuracy, 50);
  assert.equal(scoreQuestion(input({ accuracy: -1 })).breakdown.accuracy, 0);
  assert.equal(scoreQuestion(input({ accuracy: Number.NaN })).breakdown.accuracy, 0);
  assert.equal(scoreQuestion(input({ solved: true, timeMs: LIMIT, accuracy: 0.2 })).breakdown.accuracy, 50);
});

test("each wrong submission costs 5% of base, capped at 25%", () => {
  const penalty = (wrong: number) => scoreQuestion(input({ difficulty: "Medium", solved: true, timeMs: 0, wrong })).breakdown.penalty;
  assert.deepEqual([0, 1, 2, 4, 5, 6, 50].map(penalty), [0, 10, 20, 40, 50, 50, 50]);
  assert.equal(scoreQuestion(input({ difficulty: "Medium", solved: true, timeMs: 0, wrong: 9 })).points, 150);
});

test("points never go below zero", () => {
  const s = scoreQuestion(input({ accuracy: 0.1, wrong: 5 }));
  assert.equal(s.points, 0);
  assert.deepEqual(s.breakdown, { accuracy: 5, speed: 0, penalty: 25 });
});

test("points are rounded to an integer", () => {
  // 0.5 * 100 * (1/3) = 16.67
  assert.equal(scoreQuestion(input({ accuracy: 1 / 3 })).points, 17);
  // 50 + 50 * (1 - 1/3) - 5 = 78.33
  assert.equal(scoreQuestion(input({ solved: true, timeMs: LIMIT / 3, wrong: 1 })).points, 78);
});

test("submission accuracy", () => {
  assert.equal(submissionAccuracy(11, 3, 4), 0.75);
  assert.equal(submissionAccuracy(11, 0, 4), 0);
  assert.equal(submissionAccuracy(10, 1, 4), 1, "accepted forces 1");
  assert.equal(submissionAccuracy(10, null, null), 1);
  assert.equal(submissionAccuracy(20, null, null), 0, "compile error: no counts");
  assert.equal(submissionAccuracy(11, 3, 0), 0, "zero test count");
  assert.equal(submissionAccuracy(11, null, 4), 0);
  assert.equal(submissionAccuracy(11, 9, 4), 1, "clamped");
});

test("standings: score, then solved, then time, then name", () => {
  const ranked = rankStandings([
    { name: "dave", score: 100, solved: 1, timeMs: 9_000 },
    { name: "bob", score: 100, solved: 2, timeMs: 9_000 },
    { name: "alice", score: 300, solved: 1, timeMs: 50_000 },
    { name: "carol", score: 100, solved: 1, timeMs: 4_000 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.name, r.rank]), [["alice", 1], ["bob", 2], ["carol", 3], ["dave", 4]]);
});

test("standings: equal score, solved and time share a rank; the next one skips", () => {
  const ranked = rankStandings([
    { name: "Zed", score: 50, solved: 0, timeMs: 0 },
    { name: "bob", score: 200, solved: 1, timeMs: 1_000 },
    { name: "Amy", score: 200, solved: 1, timeMs: 1_000 },
    { name: "cat", score: 50, solved: 0, timeMs: 0 },
    { name: "dan", score: 10, solved: 0, timeMs: 0 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.name, r.rank]), [["Amy", 1], ["bob", 1], ["cat", 3], ["Zed", 3], ["dan", 5]]);
});

test("standings: empty and input untouched", () => {
  assert.deepEqual(rankStandings([]), []);
  const entries = [{ name: "b", score: 1, solved: 0, timeMs: 0 }, { name: "a", score: 2, solved: 0, timeMs: 0 }];
  rankStandings(entries);
  assert.equal(entries[0]!.name, "b");
});
