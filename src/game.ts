// The game: a pure state machine. Every function takes a state, an input and
// the current time, and returns the next state without touching the one it was
// given. No I/O, no clock, no randomness of its own. See docs/DESIGN.md
// "A lobby's life".

import type { FeedItem, LobbyConfig, Phase, Player, Question, QuestionResult } from "./protocol.ts";
import { DEFAULT_CONFIG, LC_STATUS_ACCEPTED, LIMITS } from "./protocol.ts";
import type { Problem, Rng } from "./questions.ts";
import { pickQuestions } from "./questions.ts";
import { scoreQuestion, submissionAccuracy } from "./scoring.ts";
import { GameError, applyConfigPatch, parseReport, sameConfig } from "./validate.ts";

export { GameError };
export { snapshot } from "./snapshot.ts";

export interface Catalog {
  problems: readonly Problem[];
  topics: ReadonlySet<string>;
}

export interface PlayerState extends Player {
  /** Left mid-match. In `lobby`, leaving removes the player instead. */
  left: boolean;
  /** One per question in the match, revealed or not. */
  results: QuestionResult[];
}

export interface QuestionState extends Question {
  /** Null until the question is revealed. */
  openedAt: number | null;
  closesAt: number | null;
}

export interface LobbyState {
  code: string;
  phase: Phase;
  /** Empty when nobody is in the lobby. */
  hostId: string;
  config: LobbyConfig;
  /** Join order. */
  players: PlayerState[];
  matchId: string | null;
  questions: QuestionState[];
  round: number;
  phaseEndsAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  feed: FeedItem[];
  nextFeedId: number;
  version: number;
  /** Every slug drawn in this lobby, so a rematch gets fresh questions. */
  playedSlugs: string[];
  /** `playerId:submissionId` for every report already counted in this match. */
  seenSubmissions: string[];
}

export interface StartDeps {
  catalog: Catalog;
  rng: Rng;
  matchId: string;
  minPlayers: number;
}

const emptyResult = (): QuestionResult => ({
  solved: false,
  timeMs: null,
  submissions: 0,
  wrong: 0,
  accuracy: 0,
  points: 0,
  breakdown: { accuracy: 0, speed: 0, penalty: 0 },
});

function edit(state: LobbyState, change: (draft: LobbyState) => void): LobbyState {
  const draft = structuredClone(state);
  change(draft);
  draft.version++;
  return draft;
}

function pushFeed(s: LobbyState, at: number, item: Omit<FeedItem, "id" | "at">): void {
  s.feed.push({ id: s.nextFeedId++, at, ...item });
  if (s.feed.length > LIMITS.feedLength) s.feed.splice(0, s.feed.length - LIMITS.feedLength);
}

const present = (s: LobbyState): PlayerState[] => s.players.filter((p) => !p.left);

function requireHost(s: LobbyState, playerId: string): void {
  if (!playerId || s.hostId !== playerId) throw new GameError("not_host", "only the host can do that");
}

function requirePhase(s: LobbyState, ...phases: Phase[]): void {
  if (!phases.includes(s.phase)) throw new GameError("wrong_phase", `not possible while the lobby is ${s.phase}`);
}

/** The host must be someone who is still here: the longest-present player. */
function fixHost(s: LobbyState): void {
  if (!present(s).some((p) => p.id === s.hostId)) s.hostId = present(s)[0]?.id ?? "";
}

export function create(code: string, host: Player, configPatch: unknown, now: number, catalog: Catalog): LobbyState {
  const config = configPatch === undefined ? { ...DEFAULT_CONFIG } : applyConfigPatch(DEFAULT_CONFIG, configPatch, catalog.topics);
  const state: LobbyState = {
    code,
    phase: "lobby",
    hostId: host.id,
    config,
    players: [{ id: host.id, name: host.name, left: false, results: [] }],
    matchId: null,
    questions: [],
    round: 0,
    phaseEndsAt: null,
    startedAt: null,
    endedAt: null,
    feed: [],
    nextFeedId: 1,
    version: 1,
    playedSlugs: [],
    seenSubmissions: [],
  };
  pushFeed(state, now, { kind: "join", playerId: host.id });
  return state;
}

/** Idempotent. New players only in `lobby`; someone who left mid-match may
 *  come back to their own seat at any time. */
export function join(state: LobbyState, player: Player, now: number): LobbyState {
  const existing = state.players.find((p) => p.id === player.id);
  if (existing && !existing.left) return state;
  if (!existing) {
    requirePhase(state, "lobby");
    if (state.players.length >= LIMITS.maxPlayers) throw new GameError("lobby_full", "this lobby is full");
  }
  return edit(state, (s) => {
    const seat = s.players.find((p) => p.id === player.id);
    if (seat) seat.left = false;
    else s.players.push({ id: player.id, name: player.name, left: false, results: [] });
    fixHost(s);
    pushFeed(s, now, { kind: "join", playerId: player.id });
    // Back with everything solved, and nobody else still working on it.
    endRoundIfAllSolved(s, now);
  });
}

export function leave(state: LobbyState, playerId: string, now: number): LobbyState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new GameError("not_in_lobby", "you are not in this lobby");
  if (player.left) return state;
  return edit(state, (s) => {
    if (s.phase === "lobby") s.players = s.players.filter((p) => p.id !== playerId);
    else s.players.find((p) => p.id === playerId)!.left = true;
    fixHost(s);
    pushFeed(s, now, { kind: "leave", playerId });
    // They may have been the only one still working on it.
    endRoundIfAllSolved(s, now);
  });
}

export function configure(state: LobbyState, playerId: string, patch: unknown, _now: number, catalog: Catalog): LobbyState {
  requireHost(state, playerId);
  requirePhase(state, "lobby");
  const config = applyConfigPatch(state.config, patch, catalog.topics);
  if (sameConfig(config, state.config)) return state;
  return edit(state, (s) => {
    s.config = config;
  });
}

export function start(state: LobbyState, playerId: string, now: number, deps: StartDeps): LobbyState {
  requireHost(state, playerId);
  requirePhase(state, "lobby");
  if (state.players.length < deps.minPlayers) {
    throw new GameError("not_enough_players", `needs at least ${deps.minPlayers} players`);
  }
  const questions = pickQuestions(deps.catalog.problems, state.config, state.playedSlugs, deps.rng);
  if (!questions) throw new GameError("not_enough_questions", "not enough unplayed questions match these settings");
  return edit(state, (s) => {
    s.matchId = deps.matchId;
    s.questions = questions.map((q) => ({ ...q, openedAt: null, closesAt: null }));
    s.playedSlugs.push(...questions.map((q) => q.slug));
    s.seenSubmissions = [];
    for (const p of s.players) p.results = questions.map(emptyResult);
    s.round = 0;
    s.phase = "countdown";
    s.phaseEndsAt = now + LIMITS.countdownMs;
    s.startedAt = now;
    s.endedAt = null;
    pushFeed(s, now, { kind: "start" });
  });
}

/** Alarm-driven transitions. Idempotent, and catches up through every deadline
 *  that has already passed: each transition happens at its scheduled time, not
 *  at `now`, so a late alarm does not stretch the match. */
export function tick(state: LobbyState, now: number): LobbyState {
  if (nextAlarmAt(state) === null || now < nextAlarmAt(state)!) return state;
  return edit(state, (s) => {
    for (let due = nextAlarmAt(s); due !== null && now >= due; due = nextAlarmAt(s)) {
      if (s.phase === "countdown") openRound(s, due);
      else closeRound(s, due);
    }
  });
}

/** When the alarm should next fire, or null when nothing is scheduled. */
export function nextAlarmAt(state: LobbyState): number | null {
  return state.phase === "countdown" || state.phase === "running" ? state.phaseEndsAt : null;
}

function openRound(s: LobbyState, at: number): void {
  const closesAt = at + s.config.timeLimitSec * 1000;
  const opening = s.config.timerMode === "overall" ? s.questions : s.questions.slice(s.round, s.round + 1);
  for (const q of opening) {
    q.openedAt = at;
    q.closesAt = closesAt;
  }
  s.phase = "running";
  s.phaseEndsAt = closesAt;
  pushFeed(s, at, { kind: "round", questionIndex: s.round });
}

function closeRound(s: LobbyState, at: number): void {
  closeOpenQuestions(s, at);
  if (s.config.timerMode === "per_question" && s.round + 1 < s.questions.length) {
    s.round++;
    s.phase = "countdown";
    s.phaseEndsAt = at + LIMITS.countdownMs;
  } else {
    finish(s, at);
  }
}

function closeOpenQuestions(s: LobbyState, at: number): void {
  for (const q of s.questions) {
    if (q.closesAt !== null && q.closesAt > at) q.closesAt = at;
  }
}

function finish(s: LobbyState, at: number): void {
  closeOpenQuestions(s, at);
  s.phase = "finished";
  s.phaseEndsAt = null;
  s.endedAt = at;
  pushFeed(s, at, { kind: "finish" });
}

/** Players who left do not hold up a round. With nobody left at all there is
 *  nobody to end it for: the clock or the host does that. */
function endRoundIfAllSolved(s: LobbyState, at: number): void {
  if (s.phase !== "running") return;
  const players = present(s);
  if (players.length === 0) return;
  const open = s.questions.flatMap((q, i) => (q.openedAt !== null && q.closesAt !== null && at < q.closesAt ? [i] : []));
  if (open.length === 0) return;
  if (players.every((p) => open.every((i) => p.results[i]!.solved))) closeRound(s, at);
}

export function submit(state: LobbyState, playerId: string, rawReport: unknown, now: number): LobbyState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.left) throw new GameError("not_in_lobby", "you are not in this lobby");
  const report = parseReport(rawReport);
  // Per player: nobody can use up an id another player is about to report.
  const seen = `${playerId}:${report.submissionId}`;
  if (state.seenSubmissions.includes(seen)) return state;

  const index = state.questions.findIndex((q) => q.slug === report.slug);
  const question = state.questions[index];
  const open =
    state.phase === "running" &&
    question !== undefined &&
    question.openedAt !== null &&
    question.closesAt !== null &&
    question.openedAt <= now &&
    now < question.closesAt;
  if (!open) throw new GameError("question_closed", "that question is not open in this lobby");
  if (player.results[index]!.solved) return state;

  return edit(state, (s) => {
    const result = s.players.find((p) => p.id === playerId)!.results[index]!;
    const accepted = report.statusCode === LC_STATUS_ACCEPTED;
    result.submissions++;
    if (accepted) {
      result.solved = true;
      result.timeMs = now - question.openedAt!;
    } else {
      result.wrong++;
    }
    result.accuracy = Math.max(
      result.accuracy,
      submissionAccuracy(report.statusCode, report.totalCorrect, report.totalTestcases),
    );
    const score = scoreQuestion({
      difficulty: question.difficulty,
      solved: result.solved,
      timeMs: result.timeMs,
      limitMs: s.config.timeLimitSec * 1000,
      accuracy: result.accuracy,
      wrong: result.wrong,
    });
    result.points = score.points;
    result.breakdown = score.breakdown;
    s.seenSubmissions.push(seen);
    pushFeed(s, now, { kind: accepted ? "solve" : "attempt", playerId, questionIndex: index, points: result.points });
    if (accepted) endRoundIfAllSolved(s, now);
  });
}

/** The host ends the match early: whatever has been scored stands. */
export function end(state: LobbyState, playerId: string, now: number): LobbyState {
  requireHost(state, playerId);
  requirePhase(state, "countdown", "running");
  return edit(state, (s) => finish(s, now));
}

/** Back to `lobby` with the same config and whoever is still here. */
export function reset(state: LobbyState, playerId: string, _now: number): LobbyState {
  requireHost(state, playerId);
  requirePhase(state, "finished");
  return edit(state, (s) => {
    s.players = present(s).map((p) => ({ ...p, results: [] }));
    fixHost(s);
    s.phase = "lobby";
    s.matchId = null;
    s.questions = [];
    s.seenSubmissions = [];
    // The feed speaks in question numbers, which mean nothing in the next
    // match. Ids carry on, so clients never see one twice.
    s.feed = [];
    s.round = 0;
    s.phaseEndsAt = null;
    s.startedAt = null;
    s.endedAt = null;
  });
}
