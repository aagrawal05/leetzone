// Membership, the host, config validation, snapshots, and every way to be told no.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, LIMITS } from "../src/protocol.ts";
import * as game from "../src/game.ts";
import { ALICE, BOB, CAROL, CATALOG, COUNTDOWN, T0, deps, errorCode, lobby, report, running, wrong } from "./fixtures.ts";

const OPEN = T0 + COUNTDOWN;
const view = (s: game.LobbyState, now: number, connected?: Set<string>) => game.snapshot(s, now, CATALOG, connected);
const configure = (s: game.LobbyState, patch: unknown) => game.configure(s, ALICE.id, patch, T0, CATALOG);

test("create: the creator is host and joined, with the default config", () => {
  const s = game.create("ABCDE", ALICE, undefined, T0, CATALOG);
  assert.deepEqual([s.code, s.phase, s.hostId, s.version], ["ABCDE", "lobby", "a", 1]);
  assert.deepEqual(s.config, DEFAULT_CONFIG);
  assert.notEqual(s.config, DEFAULT_CONFIG);
  assert.deepEqual(s.players.map((p) => p.id), ["a"]);
  assert.equal(game.create("ABCDE", ALICE, { questionCount: 5 }, T0, CATALOG).config.questionCount, 5);
  assert.equal(errorCode(() => game.create("ABCDE", ALICE, { questionCount: 99 }, T0, CATALOG)), "bad_request");
});

test("join is idempotent, bumps the version once, and is closed after the lobby phase", () => {
  const s = lobby();
  assert.equal(s.version, 2);
  assert.equal(game.join(s, BOB, T0 + 5), s);
  assert.equal(errorCode(() => game.join(running(), CAROL, OPEN)), "wrong_phase");
  assert.equal(game.join(running(), BOB, OPEN).players.length, 2, "already in: still fine mid-match");
});

test("lobby_full at maxPlayers", () => {
  let s = lobby();
  for (let i = 2; i < LIMITS.maxPlayers; i++) s = game.join(s, { id: `x${i}`, name: `x${i}` }, T0);
  assert.equal(s.players.length, LIMITS.maxPlayers);
  assert.equal(errorCode(() => game.join(s, CAROL, T0)), "lobby_full");
});

test("host hand-off: longest-present player, then whoever joins an empty lobby", () => {
  let s = game.join(lobby(), CAROL, T0 + 2);
  s = game.leave(s, ALICE.id, T0 + 3);
  assert.deepEqual([s.hostId, s.players.map((p) => p.id)], ["b", ["b", "c"]]);
  assert.equal(errorCode(() => game.configure(s, ALICE.id, {}, T0, CATALOG)), "not_host");
  s = game.leave(s, CAROL.id, T0 + 4);
  assert.equal(s.hostId, "b", "a non-host leaving changes nothing");
  s = game.leave(s, BOB.id, T0 + 5);
  assert.deepEqual([s.hostId, s.players.length, s.phase], ["", 0, "lobby"]);
  assert.equal(view(s, T0 + 5).hostId, "");
  s = game.join(s, CAROL, T0 + 6);
  assert.equal(s.hostId, "c");
  assert.equal(errorCode(() => game.leave(s, ALICE.id, T0 + 7)), "not_in_lobby");
});

test("leaving mid-match keeps the score, hands off the host, and unblocks the round", () => {
  let s = running();
  s = game.submit(s, BOB.id, report("p1"), OPEN + 1_000);
  s = game.leave(s, ALICE.id, OPEN + 2_000);
  assert.equal(s.hostId, "b");
  assert.equal(s.phase, "countdown", "bob had solved it: nobody is left to wait for");
  assert.equal(s.round, 1);
  const snap = view(s, OPEN + 2_000);
  assert.deepEqual(snap.players.map((p) => [p.name, p.left, p.score]), [["bob", false, 100], ["alice", true, 0]]);
  assert.equal(game.leave(s, ALICE.id, OPEN + 3_000), s, "leaving twice is a no-op");
  assert.equal(errorCode(() => game.submit(s, ALICE.id, report("p1"), OPEN + 3_000)), "not_in_lobby");
  assert.equal(errorCode(() => game.end(s, ALICE.id, OPEN + 3_000)), "not_host");
});

test("a player who left does not hold up later rounds, and may come back", () => {
  let s = running({ questionCount: 2 });
  s = game.leave(s, BOB.id, OPEN + 1);
  assert.equal(s.phase, "running", "alice has not solved it");
  s = game.submit(s, ALICE.id, report("p1"), OPEN + 2);
  assert.equal(s.phase, "countdown");
  s = game.tick(s, s.phaseEndsAt!);
  s = game.join(s, BOB, s.phaseEndsAt! - 10);
  assert.equal(s.players[1]!.left, false);
  s = game.submit(s, ALICE.id, report("p2"), s.phaseEndsAt! - 5);
  assert.equal(s.phase, "running", "bob is back, so the round waits for him");
});

test("if everyone leaves, only the clock or the host ends the round", () => {
  let s = running();
  s = game.leave(s, ALICE.id, OPEN + 1);
  s = game.leave(s, BOB.id, OPEN + 2);
  assert.deepEqual([s.phase, s.round, s.hostId], ["running", 0, ""]);
  s = game.tick(s, s.phaseEndsAt!);
  assert.equal(s.phase, "countdown");
  assert.equal(errorCode(() => game.join(s, CAROL, OPEN)), "wrong_phase");
  s = game.join(s, BOB, s.phaseEndsAt!);
  assert.equal(s.hostId, "b", "the first one back takes the host seat");
});

test("coming back already solved ends a round nobody else is working on", () => {
  for (const timerMode of ["per_question", "overall"] as const) {
    let s = running({ timerMode, questionCount: 1, timeLimitSec: 3600 });
    s = game.submit(s, ALICE.id, report("p1"), OPEN + 1_000);
    s = game.leave(s, ALICE.id, OPEN + 2_000);
    s = game.leave(s, BOB.id, OPEN + 3_000);
    assert.equal(s.phase, "running", "nobody is here to end it for");
    s = game.join(s, ALICE, OPEN + 4_000);
    assert.deepEqual([s.phase, s.endedAt], ["finished", OPEN + 4_000], timerMode);
  }
  let s = running();
  s = game.leave(s, BOB.id, OPEN + 1);
  assert.equal(game.join(s, BOB, OPEN + 2).phase, "running", "back unsolved: the round waits");
});

test("submission ids are counted once per player, not once per lobby", () => {
  let s = running();
  s = game.submit(s, ALICE.id, wrong("p1", 5, { submissionId: "777" }), OPEN + 1);
  assert.equal(game.submit(s, ALICE.id, wrong("p1", 5, { submissionId: "777" }), OPEN + 2), s, "a repeat is a no-op");
  s = game.submit(s, BOB.id, report("p1", { submissionId: "777" }), OPEN + 3);
  assert.equal(s.players[1]!.results[0]!.solved, true, "alice using the id first does not void bob's");
});

test("reset drops players who left and re-seats the host", () => {
  let s = running();
  s = game.leave(s, ALICE.id, OPEN + 1);
  s = game.end(s, BOB.id, OPEN + 2);
  s = game.reset(s, BOB.id, OPEN + 3);
  assert.deepEqual([s.players.map((p) => p.id), s.hostId], [["b"], "b"]);
});

test("configure: applies valid patches and canonicalises lists", () => {
  let s = configure(lobby(), { difficulties: ["Hard", "Easy", "Hard"], topics: ["string", "array", "string"], questionCount: 10, includePaid: true });
  assert.deepEqual(s.config, { ...DEFAULT_CONFIG, difficulties: ["Easy", "Hard"], topics: ["string", "array"], questionCount: 10, includePaid: true });
  assert.equal(s.version, 3);
  assert.equal(configure(s, { questionCount: 10 }), s, "no change, no new version");
  assert.equal(configure(s, {}), s);
  s = configure(s, { topics: [] });
  assert.deepEqual(s.config.topics, []);
  assert.equal(view(s, T0).poolSize, 9, "8 free Easy/Hard plus the paid one");
});

test("configure: timer mode and its limits", () => {
  let s = configure(lobby(), { timeLimitSec: 60 });
  s = configure(s, { timerMode: "overall" });
  assert.equal(s.config.timeLimitSec, 45 * 60, "60 s is out of range for overall: reset, not rejected");
  s = configure(s, { timeLimitSec: 3 * 60 * 60 });
  s = configure(s, { timerMode: "per_question" });
  assert.equal(s.config.timeLimitSec, 15 * 60);
  s = configure(s, { timerMode: "overall" });
  assert.equal(s.config.timeLimitSec, 15 * 60, "still in range: kept");
  s = configure(s, { timerMode: "per_question", timeLimitSec: 90 });
  assert.deepEqual([s.config.timerMode, s.config.timeLimitSec], ["per_question", 90]);
  assert.equal(errorCode(() => configure(s, { timerMode: "overall", timeLimitSec: 90 })), "bad_request");
});

test("configure: bad input is bad_request, never clamped", () => {
  const s = lobby();
  const bad: unknown[] = [
    null, [], "x", 7,
    { difficulties: [] }, { difficulties: ["Easy", "Extreme"] }, { difficulties: "Easy" },
    { topics: ["array", "no-such-topic"] }, { topics: "array" }, { topics: [3] },
    { questionCount: 0 }, { questionCount: 11 }, { questionCount: 2.5 }, { questionCount: "3" },
    { timeLimitSec: 59 }, { timeLimitSec: 3601 }, { timeLimitSec: 120.5 }, { timeLimitSec: null },
    { timerMode: "blitz" }, { includePaid: "yes" }, { colour: "red" },
  ];
  for (const patch of bad) assert.equal(errorCode(() => configure(s, patch)), "bad_request", JSON.stringify(patch));
});

test("host-only commands: not_host", () => {
  const s = lobby();
  assert.equal(errorCode(() => game.configure(s, BOB.id, { questionCount: 1 }, T0, CATALOG)), "not_host");
  assert.equal(errorCode(() => game.start(s, BOB.id, T0, deps())), "not_host");
  assert.equal(errorCode(() => game.start(s, "stranger", T0, deps())), "not_host");
  assert.equal(errorCode(() => game.end(running(), BOB.id, OPEN)), "not_host");
  assert.equal(errorCode(() => game.reset(game.end(running(), ALICE.id, OPEN), BOB.id, OPEN)), "not_host");
});

test("wrong_phase", () => {
  const live = running();
  const done = game.end(live, ALICE.id, OPEN + 1);
  assert.equal(errorCode(() => game.start(live, ALICE.id, OPEN, deps())), "wrong_phase");
  assert.equal(errorCode(() => game.start(done, ALICE.id, OPEN, deps())), "wrong_phase");
  assert.equal(errorCode(() => game.configure(live, ALICE.id, { questionCount: 1 }, OPEN, CATALOG)), "wrong_phase");
  assert.equal(errorCode(() => game.end(lobby(), ALICE.id, T0)), "wrong_phase");
  assert.equal(errorCode(() => game.end(done, ALICE.id, OPEN + 2)), "wrong_phase");
  assert.equal(errorCode(() => game.reset(lobby(), ALICE.id, T0)), "wrong_phase");
  assert.equal(errorCode(() => game.reset(live, ALICE.id, OPEN)), "wrong_phase");
  assert.equal(errorCode(() => game.join(done, CAROL, OPEN + 2)), "wrong_phase");
});

test("start: not_enough_players and not_enough_questions", () => {
  const solo = game.create("ABCDE", ALICE, undefined, T0, CATALOG);
  assert.equal(errorCode(() => game.start(solo, ALICE.id, T0, deps())), "not_enough_players");
  assert.equal(game.start(solo, ALICE.id, T0, deps({ minPlayers: 1 })).phase, "countdown");
  const picky = lobby({ difficulties: ["Hard"], topics: ["string"], questionCount: 3 });
  assert.equal(view(picky, T0).poolSize, 2);
  assert.equal(errorCode(() => game.start(picky, ALICE.id, T0, deps())), "not_enough_questions");
  assert.equal(picky.phase, "lobby");
});

test("submit: question_closed, not_in_lobby, bad_request", () => {
  const s = running({ questionCount: 2, timeLimitSec: 60 });
  assert.equal(errorCode(() => game.submit(s, ALICE.id, report("p2"), OPEN + 1)), "question_closed", "not revealed yet");
  assert.equal(errorCode(() => game.submit(s, ALICE.id, report("two-sum"), OPEN + 1)), "question_closed", "not in the match");
  assert.equal(errorCode(() => game.submit(s, ALICE.id, report("p1"), OPEN + 60_000)), "question_closed", "at the deadline");
  assert.equal(errorCode(() => game.submit(s, ALICE.id, report("p1"), OPEN - 1)), "question_closed", "before it opened");
  assert.equal(errorCode(() => game.submit(lobby(), ALICE.id, report("p1"), T0)), "question_closed", "no match yet");
  assert.equal(errorCode(() => game.submit(game.start(lobby(), ALICE.id, T0, deps()), ALICE.id, report("p1"), T0 + 1)), "question_closed", "countdown");

  const round2 = game.tick(s, OPEN + 60_000 + COUNTDOWN);
  assert.equal(errorCode(() => game.submit(round2, ALICE.id, report("p1"), OPEN + 60_000 + COUNTDOWN + 1)), "question_closed", "an earlier round");
  assert.equal(game.submit(round2, ALICE.id, report("p2"), OPEN + 60_000 + COUNTDOWN + 1).players[0]!.results[1]!.solved, true);

  assert.equal(errorCode(() => game.submit(s, CAROL.id, report("p1"), OPEN + 1)), "not_in_lobby");
  for (const body of [null, "x", {}, { ...report("p1"), slug: "" }, { ...report("p1"), submissionId: "" }, { ...report("p1"), statusCode: "10" }, { ...report("p1"), slug: "x".repeat(500) }]) {
    assert.equal(errorCode(() => game.submit(s, ALICE.id, body, OPEN + 1)), "bad_request", JSON.stringify(body));
  }
});

test("snapshot: join order in the lobby, standings afterwards, connected from the caller", () => {
  let s = game.join(lobby(), CAROL, T0 + 2);
  assert.deepEqual(view(s, T0, new Set(["b"])).players.map((p) => [p.name, p.connected]), [["alice", false], ["bob", true], ["carol", false]]);
  s = game.tick(game.start(s, ALICE.id, T0, deps()), OPEN);
  s = game.submit(s, CAROL.id, report("p1"), OPEN + 1_000);
  s = game.submit(s, BOB.id, wrong("p1", 9), OPEN + 2_000);
  const snap = view(s, OPEN + 5_000);
  assert.deepEqual(snap.players.map((p) => p.name), ["carol", "bob", "alice"]);
  assert.deepEqual([snap.now, snap.version, snap.round, snap.phaseEndsAt, snap.startedAt, snap.endedAt], [OPEN + 5_000, s.version, 0, s.phaseEndsAt, T0, null]);
  assert.deepEqual(snap.players.map((p) => p.results.length), [1, 1, 1], "results align with revealed questions");
  assert.equal(JSON.stringify(snap).includes("p2"), false, "nothing about future questions leaks");
});

test("the feed is capped and its ids keep increasing", () => {
  let s = running();
  for (let i = 0; i < 40; i++) s = game.submit(s, ALICE.id, wrong("p1", 1), OPEN + i);
  assert.equal(s.feed.length, LIMITS.feedLength);
  assert.equal(s.feed.at(-1)!.id, 44);
  assert.equal(s.feed[0]!.id, 44 - LIMITS.feedLength + 1);
  assert.deepEqual(s.feed.at(-1), { id: 44, at: OPEN + 39, kind: "attempt", playerId: "a", questionIndex: 0, points: 0 });
});

test("stored strings are bounded, and states are never mutated in place", () => {
  const s = running();
  const frozen = structuredClone(s);
  const next = game.submit(s, ALICE.id, { ...wrong("p1"), statusMsg: "x".repeat(5000), lang: "y".repeat(5000) }, OPEN + 1);
  assert.deepEqual(s, frozen);
  assert.equal(next.version, s.version + 1);
  assert.ok(JSON.stringify(next).length < JSON.stringify(s).length + 500);
});
