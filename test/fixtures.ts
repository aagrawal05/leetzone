// Shared by the game tests: a tiny catalog, two players, and shorthands.

import type { LobbyConfig, SubmissionReport } from "../src/protocol.ts";
import { LIMITS } from "../src/protocol.ts";
import type { Catalog, LobbyState, StartDeps } from "../src/game.ts";
import * as game from "../src/game.ts";
import type { Problem } from "../src/questions.ts";

const difficulties = ["Easy", "Medium", "Hard"] as const;

/** 12 free problems p1..p12 cycling Easy/Medium/Hard, plus one paid. */
export const PROBLEMS: Problem[] = [
  ...Array.from({ length: 12 }, (_, i): Problem => ({
    id: i + 1,
    slug: `p${i + 1}`,
    title: `Problem ${i + 1}`,
    difficulty: difficulties[i % 3]!,
    paid: false,
    topics: i % 2 === 0 ? ["array"] : ["string"],
  })),
  { id: 13, slug: "p13", title: "Problem 13", difficulty: "Easy", paid: true, topics: ["array"] },
];

export const CATALOG: Catalog = { problems: PROBLEMS, topics: new Set(["array", "string"]) };

export const ALICE = { id: "a", name: "alice" };
export const BOB = { id: "b", name: "bob" };
export const CAROL = { id: "c", name: "carol" };

export const T0 = 1_000_000;
export const COUNTDOWN = LIMITS.countdownMs;

/** Always takes the first remaining candidate: questions come out in catalog order. */
export const first = (): number => 0;

export function deps(over: Partial<StartDeps> = {}): StartDeps {
  return { catalog: CATALOG, rng: first, matchId: "match-1", minPlayers: 2, ...over };
}

/** alice (host) and bob in a lobby. */
export function lobby(config: Partial<LobbyConfig> = {}): LobbyState {
  const s = game.create("ABCDE", ALICE, config, T0, CATALOG);
  return game.join(s, BOB, T0 + 1);
}

/** Started and past the first countdown: running since T0 + COUNTDOWN. */
export function running(config: Partial<LobbyConfig> = {}): LobbyState {
  const s = game.start(lobby(config), ALICE.id, T0, deps());
  return game.tick(s, T0 + COUNTDOWN);
}

let nextId = 1;

export function report(slug: string, over: Partial<SubmissionReport> = {}): SubmissionReport {
  return {
    slug,
    submissionId: String(nextId++),
    statusCode: 10,
    statusMsg: "Accepted",
    totalCorrect: 10,
    totalTestcases: 10,
    lang: "python3",
    ...over,
  };
}

export const wrong = (slug: string, correct = 5, over: Partial<SubmissionReport> = {}): SubmissionReport =>
  report(slug, { statusCode: 11, statusMsg: "Wrong Answer", totalCorrect: correct, totalTestcases: 10, ...over });

export function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof game.GameError) return err.code;
    throw err;
  }
}
