// Picking questions from the catalog. Pure: the catalog and the randomness are
// parameters, so tests are deterministic.

import type { Difficulty, LobbyConfig, Question } from "./protocol.ts";

/** One entry of data/problems.json. */
export interface Problem {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  paid: boolean;
  topics: string[];
}

/** Returns a float in [0, 1), like Math.random. */
export type Rng = () => number;

type Filter = Pick<LobbyConfig, "difficulties" | "topics" | "includePaid">;

export function matches(problem: Problem, config: Filter): boolean {
  if (problem.paid && !config.includePaid) return false;
  if (!config.difficulties.includes(problem.difficulty)) return false;
  if (config.topics.length === 0) return true;
  return problem.topics.some((t) => config.topics.includes(t));
}

function pool(catalog: readonly Problem[], config: Filter, excludeSlugs: Iterable<string>): Problem[] {
  const excluded = new Set(excludeSlugs);
  return catalog.filter((p) => !excluded.has(p.slug) && matches(p, config));
}

export function poolSize(catalog: readonly Problem[], config: Filter, excludeSlugs: Iterable<string> = []): number {
  return pool(catalog, config, excludeSlugs).length;
}

export function toQuestion(problem: Problem): Question {
  return {
    id: String(problem.id),
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    topics: [...problem.topics],
  };
}

/** Draws `config.questionCount` questions uniformly, without replacement.
 *  Returns null when the pool is too small. */
export function pickQuestions(
  catalog: readonly Problem[],
  config: LobbyConfig,
  excludeSlugs: Iterable<string>,
  rng: Rng,
): Question[] | null {
  const candidates = pool(catalog, config, excludeSlugs);
  if (candidates.length < config.questionCount) return null;
  // Partial Fisher-Yates: only the first `questionCount` slots are shuffled.
  for (let i = 0; i < config.questionCount; i++) {
    const j = i + Math.min(candidates.length - i - 1, Math.floor(rng() * (candidates.length - i)));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  return candidates.slice(0, config.questionCount).map(toQuestion);
}
