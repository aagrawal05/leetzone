// The bundled LeetCode catalog (`npm run sync:catalog`). Parsed once per
// isolate, at module load; never per request.

import problemsJson from "../data/problems.json" with { type: "json" };
import topicsJson from "../data/topics.json" with { type: "json" };
import type { TopicInfo } from "./protocol.ts";
import type { Catalog } from "./game.ts";
import type { Problem } from "./questions.ts";

export const PROBLEMS = problemsJson as readonly Problem[];
export const TOPICS = topicsJson as readonly TopicInfo[];

export const CATALOG: Catalog = {
  problems: PROBLEMS,
  topics: new Set(TOPICS.map((t) => t.slug)),
};
