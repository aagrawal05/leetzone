// The Durable Object shell (src/lobby.ts) under Node, with just enough of a fake
// runtime to drive orderings a local workerd will not produce on demand.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { ALICE, BOB, COUNTDOWN, report } from "./fixtures.ts";

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "cloudflare:workers" ? { url: "fake:cloudflare-workers", shortCircuit: true } : next(specifier, context),
  load: (url, context, next) =>
    url === "fake:cloudflare-workers"
      ? { format: "module", shortCircuit: true, source: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }" }
      : next(url, context),
});
Object.assign(globalThis, { WebSocketRequestResponsePair: class {} });
const { Lobby } = await import("../src/lobby.ts");

/** A lobby over in-memory storage and a D1 that takes `d1.delayMs` to answer. */
function makeLobby() {
  const stored = new Map<string, unknown>();
  const d1 = { delayMs: 0, batches: 0 };
  let alarm: number | null = null;
  let lists = 0;
  const kv = {
    get: (key: string) => structuredClone(stored.get(key)),
    put: (key: string, value: unknown) => void stored.set(key, structuredClone(value)),
    delete: (key: string) => stored.delete(key),
    // Like workerd: starting a new list invalidates an iterator still in use.
    *list({ prefix = "", limit = Infinity }: { prefix?: string; limit?: number } = {}) {
      const mine = ++lists;
      for (const key of [...stored.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)) {
        yield [key, structuredClone(stored.get(key))];
        if (lists !== mine) throw new Error("kv.list() iterator was invalidated");
      }
    },
  };
  const storage = {
    kv,
    getAlarm: async () => alarm,
    setAlarm: async (at: number) => void (alarm = at),
    deleteAlarm: async () => void (alarm = null),
  };
  const DB = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
    async batch() {
      await new Promise((resolve) => setTimeout(resolve, d1.delayMs));
      d1.batches++;
      return [];
    },
  };
  const ctx = { storage, getWebSockets: () => [], setWebSocketAutoResponse() {} };
  const lobby = new Lobby(ctx as unknown as DurableObjectState, { DB, MIN_PLAYERS: "2" } as unknown as Env);
  const pending = () => [...stored.keys()].filter((k) => k.startsWith("pending:"));
  return { lobby, d1, pending, alarm: () => alarm };
}

/** alice and bob in a running one-question, 60 s match that bob has scored in. */
async function scoredMatch(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"] });
  const made = makeLobby();
  const { lobby } = made;
  await lobby.create("ABCDE", ALICE, { questionCount: 1, timeLimitSec: 60 });
  await lobby.join(BOB);
  await lobby.start(ALICE.id);
  t.mock.timers.tick(COUNTDOWN);
  await lobby.alarm();
  const running = await lobby.get();
  assert.ok(running.ok);
  const { slug } = running.snapshot.questions[0]!;
  await lobby.submit(BOB.id, report(slug, { statusCode: 11, totalCorrect: 5 }));
  return made;
}

test("a match that finishes and is reset in the same event still reaches D1", async (t) => {
  const { lobby, d1, pending, alarm } = await scoredMatch(t);
  t.mock.timers.tick(60_000); // the deadline passes, and the alarm is late
  const reset = await lobby.reset(ALICE.id);
  assert.ok(reset.ok);
  assert.equal(reset.snapshot.phase, "lobby");
  assert.deepEqual([d1.batches, pending(), alarm()], [1, [], null]);
});

test("requests that overlap the D1 write of a finished match all succeed", async (t) => {
  const { lobby, d1, pending } = await scoredMatch(t);
  d1.delayMs = 5;
  const results = await Promise.all([lobby.end(ALICE.id), lobby.get(), lobby.join(BOB), lobby.get()]);
  assert.deepEqual(results.map((r) => r.ok && r.snapshot.phase), ["finished", "finished", "finished", "finished"]);
  assert.deepEqual(pending(), []);
  assert.ok(d1.batches >= 1);
});

test("a match D1 did not take stays pending and is retried", async (t) => {
  const { lobby, d1, pending, alarm } = await scoredMatch(t);
  const DB = (lobby as unknown as { env: { DB: { batch(): Promise<unknown[]> } } }).env.DB;
  const working = DB.batch;
  DB.batch = async () => Promise.reject(new Error("D1 is down"));
  t.mock.method(console, "error", () => {});
  const ended = await lobby.end(ALICE.id);
  assert.ok(ended.ok, "the match still ends");
  assert.equal(pending().length, 1);
  assert.equal(alarm(), Date.now() + 30_000);
  DB.batch = working;
  await lobby.alarm();
  assert.deepEqual([d1.batches, pending(), alarm()], [1, [], null]);
});
