import assert from "node:assert/strict";
import { test } from "node:test";
import type { LobbyConfig } from "../src/protocol.ts";
import { DEFAULT_CONFIG } from "../src/protocol.ts";
import type { Problem, Rng } from "../src/questions.ts";
import { matches, pickQuestions, poolSize } from "../src/questions.ts";

const problem = (id: number, difficulty: Problem["difficulty"], topics: string[], paid = false): Problem => ({
  id,
  slug: `p${id}`,
  title: `Problem ${id}`,
  difficulty,
  paid,
  topics,
});

const CATALOG: Problem[] = [
  problem(1, "Easy", ["array", "hash-table"]),
  problem(2, "Medium", ["linked-list"]),
  problem(3, "Hard", ["array"]),
  problem(4, "Easy", ["string"], true),
  problem(5, "Medium", ["array", "string"]),
  problem(6, "Easy", []),
  problem(7, "Hard", ["graph"], true),
  problem(8, "Medium", ["graph"]),
];

const config = (over: Partial<LobbyConfig> = {}): LobbyConfig => ({ ...DEFAULT_CONFIG, ...over });
const ALL = { difficulties: ["Easy", "Medium", "Hard"] as LobbyConfig["difficulties"] };

/** mulberry32: small, seeded, good enough to check uniformity. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slugs = (c: LobbyConfig, exclude: string[] = []) =>
  CATALOG.filter((p) => !exclude.includes(p.slug) && matches(p, c)).map((p) => p.slug);

test("filters by difficulty", () => {
  assert.deepEqual(slugs(config({ difficulties: ["Hard"] })), ["p3"]);
  assert.deepEqual(slugs(config({ difficulties: ["Easy", "Medium"] })), ["p1", "p2", "p5", "p6", "p8"]);
});

test("paid problems only when asked for", () => {
  assert.deepEqual(slugs(config({ difficulties: ["Hard"], includePaid: true })), ["p3", "p7"]);
  assert.deepEqual(slugs(config({ difficulties: ["Easy"], includePaid: true })), ["p1", "p4", "p6"]);
});

test("topics match on any; none means any topic, including untagged problems", () => {
  assert.deepEqual(slugs(config({ ...ALL, topics: ["array"] })), ["p1", "p3", "p5"]);
  assert.deepEqual(slugs(config({ ...ALL, topics: ["graph", "linked-list"] })), ["p2", "p8"]);
  assert.deepEqual(slugs(config({ ...ALL, topics: ["string"] })), ["p5"]);
  assert.deepEqual(slugs(config({ ...ALL, topics: ["nope"] })), []);
  assert.ok(slugs(config(ALL)).includes("p6"));
  assert.ok(!slugs(config({ ...ALL, topics: ["array"] })).includes("p6"));
});

test("poolSize counts matches, minus excluded slugs", () => {
  assert.equal(poolSize(CATALOG, config(ALL)), 6);
  assert.equal(poolSize(CATALOG, config({ ...ALL, includePaid: true })), 8);
  assert.equal(poolSize(CATALOG, config(ALL), ["p1", "p3", "not-in-catalog"]), 4);
  assert.equal(poolSize(CATALOG, config(ALL), new Set(["p4"])), 6, "excluding a non-match changes nothing");
});

test("picks the requested number, distinct, all matching", () => {
  const c = config({ ...ALL, questionCount: 4 });
  const picked = pickQuestions(CATALOG, c, [], seeded(1))!;
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked.map((q) => q.slug)).size, 4);
  for (const q of picked) assert.ok(slugs(c).includes(q.slug));
});

test("questions carry the protocol shape", () => {
  const [q] = pickQuestions(CATALOG, config({ difficulties: ["Hard"], questionCount: 1 }), [], seeded(1))!;
  assert.deepEqual(q, { id: "3", slug: "p3", title: "Problem 3", difficulty: "Hard", topics: ["array"] });
});

test("never picks an excluded slug", () => {
  const c = config({ ...ALL, questionCount: 3 });
  for (let seed = 0; seed < 50; seed++) {
    const picked = pickQuestions(CATALOG, c, ["p1", "p2", "p3"], seeded(seed))!;
    assert.deepEqual(picked.map((q) => q.slug).sort(), ["p5", "p6", "p8"]);
  }
});

test("null when the pool is too small", () => {
  assert.equal(pickQuestions(CATALOG, config({ difficulties: ["Hard"], questionCount: 2 }), [], seeded(1)), null);
  assert.equal(pickQuestions(CATALOG, config({ ...ALL, questionCount: 6 }), ["p1"], seeded(1)), null);
  assert.equal(pickQuestions([], config({ questionCount: 1 }), [], seeded(1)), null);
  assert.equal(pickQuestions(CATALOG, config({ ...ALL, questionCount: 6 }), [], seeded(1))!.length, 6);
});

test("deterministic for a given rng, and does not touch the catalog", () => {
  const c = config({ ...ALL, questionCount: 3 });
  const before = JSON.stringify(CATALOG);
  const a = pickQuestions(CATALOG, c, [], seeded(42));
  const b = pickQuestions(CATALOG, c, [], seeded(42));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(CATALOG), before);
  const orders = new Set(Array.from({ length: 30 }, (_, seed) => pickQuestions(CATALOG, c, [], seeded(seed))!.map((q) => q.slug).join()));
  assert.ok(orders.size > 5, "different seeds give different draws");
});

test("survives an rng at the edges of its range", () => {
  const c = config({ ...ALL, questionCount: 6 });
  assert.equal(new Set(pickQuestions(CATALOG, c, [], () => 0)!.map((q) => q.slug)).size, 6);
  assert.equal(new Set(pickQuestions(CATALOG, c, [], () => 0.999999)!.map((q) => q.slug)).size, 6);
  assert.equal(new Set(pickQuestions(CATALOG, c, [], () => 1)!.map((q) => q.slug)).size, 6);
});

test("the draw is uniform", () => {
  const c = config({ ...ALL, questionCount: 2 });
  const rng = seeded(7);
  const counts = new Map<string, number>();
  const draws = 6000;
  for (let i = 0; i < draws; i++) {
    for (const q of pickQuestions(CATALOG, c, [], rng)!) counts.set(q.slug, (counts.get(q.slug) ?? 0) + 1);
  }
  // Each of 6 problems should appear in 2/6 of the draws.
  for (const slug of slugs(c)) {
    const share = (counts.get(slug) ?? 0) / draws;
    assert.ok(Math.abs(share - 1 / 3) < 0.03, `${slug} drawn ${share}`);
  }
});
