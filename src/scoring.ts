// Scoring and standings. Pure: see docs/DESIGN.md "Scoring".

import type { Difficulty, ScoreBreakdown } from "./protocol.ts";
import { LC_STATUS_ACCEPTED } from "./protocol.ts";

export const BASE_POINTS: Record<Difficulty, number> = { Easy: 100, Medium: 200, Hard: 300 };
/** Share of `base` earned by test cases passed, and by solving early. */
export const ACCURACY_WEIGHT = 0.5;
export const SPEED_WEIGHT = 0.5;
/** Each wrong submission costs this share of `base`, up to the cap. */
export const WRONG_PENALTY = 0.05;
export const MAX_PENALTY = 0.25;

export interface ScoreInput {
  difficulty: Difficulty;
  solved: boolean;
  /** Ms from the question opening to the accepted submission; ignored unless solved. */
  timeMs: number | null;
  limitMs: number;
  /** Best fraction of test cases passed, 0..1. */
  accuracy: number;
  wrong: number;
}

export interface Score {
  points: number;
  breakdown: ScoreBreakdown;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Half rounds up even when floating point lands a hair under it (47.5 computed
 *  as 47.49999999999999). The nudge is far smaller than one test case or one
 *  millisecond is worth, so nothing else changes. */
const round = (x: number): number => Math.round(x + 1e-9);

export function scoreQuestion(input: ScoreInput): Score {
  const base = BASE_POINTS[input.difficulty];
  const accuracy = input.solved ? 1 : clamp01(input.accuracy);
  const speed =
    input.solved && input.limitMs > 0 ? clamp01(1 - (input.timeMs ?? input.limitMs) / input.limitMs) : 0;
  const wrong = Math.max(0, input.wrong);

  const accuracyPoints = ACCURACY_WEIGHT * base * accuracy;
  const speedPoints = SPEED_WEIGHT * base * speed;
  const penalty = base * Math.min(MAX_PENALTY, WRONG_PENALTY * wrong);

  return {
    points: Math.max(0, round(accuracyPoints + speedPoints - penalty)),
    // Rounded for display. `points` is rounded from the exact sum, so the terms
    // can be off by one against it.
    breakdown: {
      accuracy: round(accuracyPoints),
      speed: round(speedPoints),
      penalty: round(penalty),
    },
  };
}

/** The accuracy one judged submission is worth. */
export function submissionAccuracy(
  statusCode: number,
  totalCorrect: number | null,
  totalTestcases: number | null,
): number {
  if (statusCode === LC_STATUS_ACCEPTED) return 1;
  if (typeof totalCorrect !== "number" || typeof totalTestcases !== "number") return 0;
  if (!(totalTestcases > 0)) return 0;
  return clamp01(totalCorrect / totalTestcases);
}

export interface Standing {
  name: string;
  score: number;
  solved: number;
  /** Total solve time over solved questions. */
  timeMs: number;
}

/** Score, then questions solved, then total solve time (lower first). */
function compareStanding(a: Standing, b: Standing): number {
  return b.score - a.score || b.solved - a.solved || a.timeMs - b.timeMs;
}

/** Best first, names breaking ties for a stable order. Equal score, solved and
 *  time share a rank; the next rank skips (1, 1, 3). */
export function rankStandings<T extends Standing>(entries: readonly T[]): (T & { rank: number })[] {
  const sorted = [...entries].sort(
    (a, b) => compareStanding(a, b) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name),
  );
  let rank = 0;
  return sorted.map((entry, i) => {
    const prev = sorted[i - 1];
    if (!prev || compareStanding(prev, entry) !== 0) rank = i + 1;
    return { ...entry, rank };
  });
}
