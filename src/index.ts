// The Worker: routes /api/*, authenticates, and hands lobby commands to the
// Lobby object. Everything else is the static site. See docs/DESIGN.md "HTTP API".

import type { CreatePlayerResponse, MetaResponse, Player } from "./protocol.ts";
import { DEFAULT_CONFIG, LIMITS } from "./protocol.ts";
import { TOPICS } from "./catalog.ts";
import * as db from "./db.ts";
import { error, json, methodNotAllowed, readJson } from "./http.ts";
import type { LobbyResult } from "./lobby.ts";
import { Lobby, minPlayers } from "./lobby.ts";
import { GameError, validLcUsername } from "./validate.ts";

export { Lobby };

interface Call {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  /** Captures from the route pattern. */
  params: string[];
}

type Handler = (call: Call) => Promise<Response>;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const CODE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const NAME = /^[A-Za-z0-9 _-]+$/;

const ROUTES: [method: string, path: RegExp, handler: Handler][] = [
  ["GET", /^\/api\/meta$/, meta],
  ["POST", /^\/api\/players$/, createPlayer],
  ["GET", /^\/api\/me$/, async (call) => json(await authenticate(call))],
  ["GET", /^\/api\/players\/([^/]+)$/, profile],
  ["GET", /^\/api\/leaderboard$/, async ({ env }) => json({ rows: await db.leaderboard(env.DB) })],
  ["POST", /^\/api\/lobbies$/, createLobby],
  ["GET", /^\/api\/lobbies\/([^/]+)$/, async (call) => reply(await lobby(call).get())],
  ["GET", /^\/api\/lobbies\/([^/]+)\/ws$/, socket],
  ["POST", /^\/api\/lobbies\/([^/]+)\/join$/, async (call) => reply(await lobby(call).join(await authenticate(call)))],
  ["POST", /^\/api\/lobbies\/([^/]+)\/leave$/, async (call) => reply(await lobby(call).leave((await authenticate(call)).id))],
  ["PATCH", /^\/api\/lobbies\/([^/]+)\/config$/, configure],
  ["POST", /^\/api\/lobbies\/([^/]+)\/start$/, async (call) => reply(await lobby(call).start((await authenticate(call)).id))],
  ["POST", /^\/api\/lobbies\/([^/]+)\/end$/, async (call) => reply(await lobby(call).end((await authenticate(call)).id))],
  ["POST", /^\/api\/lobbies\/([^/]+)\/reset$/, async (call) => reply(await lobby(call).reset((await authenticate(call)).id))],
  ["POST", /^\/api\/lobbies\/([^/]+)\/submissions$/, submit],
];

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const matching = ROUTES.filter(([, path]) => path.test(pathname));
    if (matching.length === 0) return error("not_found", "no such endpoint");
    const route = matching.find(([method]) => method === request.method);
    if (!route) return methodNotAllowed(matching.map(([method]) => method).join(", "));

    try {
      const params = route[1].exec(pathname)!.slice(1);
      return await route[2]({ request, env, ctx, params });
    } catch (err) {
      if (err instanceof GameError) return error(err.code, err.message);
      console.error(err);
      return json({ error: { code: "internal", message: "something went wrong" } }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ---- players ----------------------------------------------------------------

async function meta({ env }: Call): Promise<Response> {
  return json({
    topics: [...TOPICS],
    limits: LIMITS,
    defaults: DEFAULT_CONFIG,
    minPlayers: minPlayers(env),
    inviteRequired: Boolean(env.INVITE_CODE),
  } satisfies MetaResponse);
}

async function createPlayer({ request, env }: Call): Promise<Response> {
  const body = asRecord(await readJson(request));
  if (env.INVITE_CODE && !(await sameSecret(body.invite, env.INVITE_CODE))) {
    throw new GameError("invite_required", "a valid invite code is needed");
  }
  const name = parseName(body.name);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const player = await db.createPlayer(env.DB, { id: crypto.randomUUID(), name }, token, Date.now());
  if (!player) throw new GameError("name_taken", "that name is taken");
  return json({ ...player, token } satisfies CreatePlayerResponse, 201);
}

async function profile({ env, params }: Call): Promise<Response> {
  const found = await db.profile(env.DB, parseName(decode(params[0]!), "not_found"));
  if (!found) throw new GameError("not_found", "no such player");
  return json(found);
}

/** 2-20 of `[A-Za-z0-9 _-]`, trimmed, no doubled spaces. */
function parseName(value: unknown, code: "bad_request" | "not_found" = "bad_request"): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax || !NAME.test(name) || name.includes("  ")) {
    throw new GameError(code, `a name is ${LIMITS.nameMin}-${LIMITS.nameMax} letters, digits, spaces, _ or -`);
  }
  return name;
}

async function authenticate({ request, env }: Call): Promise<Player> {
  const token = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  const player = token ? await db.playerByToken(env.DB, token) : null;
  if (!player) throw new GameError("unauthorized", "sign in first");
  return player;
}

/** Constant-time: both sides are hashed first, so length does not leak either. */
async function sameSecret(given: unknown, expected: string): Promise<boolean> {
  if (typeof given !== "string") return false;
  const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.timingSafeEqual(await digest(given), await digest(expected));
}

// ---- lobbies ----------------------------------------------------------------

async function createLobby(call: Call): Promise<Response> {
  const player = await authenticate(call);
  const body = asRecord(await readJson(call.request));
  // 31^5 codes: a collision is rare, and a few retries make it invisible.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    const result = await call.env.LOBBY.getByName(code).create(code, player, body.config);
    if (result.ok || result.code !== "conflict") return reply(result, 201);
  }
  throw new GameError("conflict", "could not find a free lobby code; try again");
}

async function configure(call: Call): Promise<Response> {
  const player = await authenticate(call);
  return reply(await lobby(call).configure(player.id, await readJson(call.request)));
}

async function submit(call: Call): Promise<Response> {
  const player = await authenticate(call);
  const report = await readJson(call.request);
  const result = await lobby(call).submit(player.id, report);
  if (result.ok) {
    const { lcUsername } = asRecord(report);
    // Profile metadata only: never worth failing the report over.
    if (validLcUsername(lcUsername)) {
      call.ctx.waitUntil(db.setLcUsername(call.env.DB, player.id, lcUsername).catch(() => {}));
    }
  }
  return reply(result);
}

async function socket(call: Call): Promise<Response> {
  if (call.request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new GameError("bad_request", "this endpoint is a WebSocket");
  }
  return lobby(call).fetch(call.request);
}

/** The Lobby object for the code in the path. Codes match case-insensitively. */
function lobby({ env, params }: Call): DurableObjectStub<Lobby> {
  const code = decode(params[0]!).toUpperCase();
  if (!CODE.test(code)) throw new GameError("not_found", "no such lobby");
  return env.LOBBY.getByName(code);
}

function reply(result: LobbyResult, status = 200): Response {
  return result.ok ? json(result.snapshot, status) : error(result.code, result.message);
}

function newCode(): string {
  let code = "";
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (code.length < CODE_LENGTH) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (byte < limit) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

// ---- small things -----------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GameError("bad_request", "request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new GameError("not_found", "no such resource");
  }
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
