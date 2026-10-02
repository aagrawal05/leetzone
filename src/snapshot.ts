// Views of a lobby state: what clients see, and what goes to D1. Pure.

import type { Difficulty, LobbyConfig, LobbySnapshot, QuestionResult, QuestionSnapshot } from "./protocol.ts";
import type { Catalog, LobbyState, PlayerState } from "./game.ts";
import { poolSize } from "./questions.ts";
import { rankStandings } from "./scoring.ts";

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Final or running standings, best first. Results cover revealed questions only. */
function standings(state: LobbyState, revealed: number[]) {
  return rankStandings(
    state.players.map((p) => {
      const results = revealed.map((i) => p.results[i]!);
      return {
        player: p,
        name: p.name,
        results,
        score: sum(results.map((r) => r.points)),
        solved: results.filter((r) => r.solved).length,
        timeMs: sum(results.map((r) => (r.solved ? (r.timeMs ?? 0) : 0))),
      };
    }),
  );
}

/** Questions that have been opened. In `per_question` mode that is the rounds
 *  so far, so nobody can read ahead. */
function revealedIndexes(state: LobbyState): number[] {
  return state.questions.flatMap((q, i) => (q.openedAt !== null ? [i] : []));
}

export function snapshot(
  state: LobbyState,
  now: number,
  catalog: Catalog,
  connected: ReadonlySet<string> = new Set(),
): LobbySnapshot {
  const revealed = revealedIndexes(state);
  const ranked = standings(state, revealed);
  // Join order while waiting; standings once there is something to rank.
  const ordered = state.phase === "lobby" ? state.players.map((p) => ranked.find((r) => r.player === p)!) : ranked;

  return {
    code: state.code,
    phase: state.phase,
    hostId: state.hostId,
    config: state.config,
    poolSize: poolSize(catalog.problems, state.config, state.playedSlugs),
    players: ordered.map((r) => ({
      id: r.player.id,
      name: r.player.name,
      connected: connected.has(r.player.id),
      left: r.player.left,
      score: r.score,
      solved: r.solved,
      results: r.results,
    })),
    matchId: state.matchId,
    questionCount: state.questions.length,
    questions: revealed.map((i): QuestionSnapshot => {
      const q = state.questions[i]!;
      return {
        id: q.id,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        topics: q.topics,
        index: i,
        url: `https://leetcode.com/problems/${q.slug}/`,
        openedAt: q.openedAt!,
        closesAt: q.closesAt!,
      };
    }),
    round: state.round,
    phaseEndsAt: state.phaseEndsAt,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    feed: state.feed,
    version: state.version,
    now,
  };
}

export interface MatchRecord {
  matchId: string;
  lobbyCode: string;
  config: LobbyConfig;
  questionCount: number;
  startedAt: number;
  endedAt: number;
  players: {
    playerId: string;
    score: number;
    rank: number;
    solved: number;
    submissions: number;
    results: (QuestionResult & { questionIndex: number; slug: string; difficulty: Difficulty })[];
  }[];
}

/** A finished match as it is stored, or null when there is nothing worth
 *  storing: nobody in it, or nobody submitted anything. */
export function matchRecord(state: LobbyState): MatchRecord | null {
  if (state.phase !== "finished" || state.matchId === null) return null;
  const submitted = (p: PlayerState): number => sum(p.results.map((r) => r.submissions));
  if (state.players.length === 0 || sum(state.players.map(submitted)) === 0) return null;

  const revealed = revealedIndexes(state);
  return {
    matchId: state.matchId,
    lobbyCode: state.code,
    config: state.config,
    questionCount: state.questions.length,
    startedAt: state.startedAt ?? state.endedAt ?? 0,
    endedAt: state.endedAt ?? 0,
    players: standings(state, revealed).map((r) => ({
      playerId: r.player.id,
      score: r.score,
      rank: r.rank,
      solved: r.solved,
      submissions: sum(r.results.map((x) => x.submissions)),
      results: r.results.map((result, k) => {
        const q = state.questions[revealed[k]!]!;
        return { ...result, questionIndex: revealed[k]!, slug: q.slug, difficulty: q.difficulty };
      }),
    })),
  };
}
