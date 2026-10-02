// One Durable Object per lobby code: a thin shell around src/game.ts. Load the
// state, apply a pure function, save, re-arm the alarm, broadcast. Nothing is
// held in memory between events, so the object can hibernate at any time.

import { DurableObject } from "cloudflare:workers";
import type { ErrorCode, LobbySnapshot, Player, ServerMessage } from "./protocol.ts";
import { CATALOG } from "./catalog.ts";
import { playerByToken, recordMatch } from "./db.ts";
import type { LobbyState } from "./game.ts";
import * as game from "./game.ts";
import { error } from "./http.ts";
import type { MatchRecord } from "./snapshot.ts";
import { matchRecord } from "./snapshot.ts";

/** Thrown errors do not cross RPC intact, so failures are returned as values. */
export type LobbyResult = { ok: true; snapshot: LobbySnapshot } | { ok: false; code: ErrorCode; message: string };

interface Attachment {
  playerId: string;
}

const STATE = "state";
/** Finished matches not yet in D1, one key per match id. */
const PENDING = "pending:";
const RETRY_MS = 30_000;
const MAX_MESSAGE_CHARS = 2048;

export function minPlayers(env: Env): number {
  const n = Number.parseInt(env.MIN_PLAYERS ?? "", 10);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

const random = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- RPC ------------------------------------------------------------------

  /** The object stores its own code rather than trusting `ctx.id.name`. */
  async create(code: string, host: Player, configPatch: unknown): Promise<LobbyResult> {
    if (this.load()) return { ok: false, code: "conflict", message: "lobby code already in use" };
    const now = Date.now();
    try {
      const state = game.create(code, host, configPatch, now, CATALOG);
      this.ctx.storage.kv.put(STATE, state);
      return { ok: true, snapshot: this.view(state, now) };
    } catch (err) {
      return failure(err);
    }
  }

  async get(): Promise<LobbyResult> {
    return this.apply((s) => s);
  }

  async join(player: Player): Promise<LobbyResult> {
    return this.apply((s, now) => game.join(s, player, now));
  }

  async leave(playerId: string): Promise<LobbyResult> {
    return this.apply((s, now) => game.leave(s, playerId, now));
  }

  async configure(playerId: string, patch: unknown): Promise<LobbyResult> {
    return this.apply((s, now) => game.configure(s, playerId, patch, now, CATALOG));
  }

  async start(playerId: string): Promise<LobbyResult> {
    return this.apply((s, now) =>
      game.start(s, playerId, now, {
        catalog: CATALOG,
        rng: random,
        matchId: crypto.randomUUID(),
        minPlayers: minPlayers(this.env),
      }),
    );
  }

  async end(playerId: string): Promise<LobbyResult> {
    return this.apply((s, now) => game.end(s, playerId, now));
  }

  async reset(playerId: string): Promise<LobbyResult> {
    return this.apply((s, now) => game.reset(s, playerId, now));
  }

  async submit(playerId: string, report: unknown): Promise<LobbyResult> {
    return this.apply((s, now) => game.submit(s, playerId, report, now));
  }

  // ---- timers ---------------------------------------------------------------

  /** Delivered at least once and sometimes late: `game.tick` is idempotent and
   *  catches up. Also the retry path for a match D1 did not take. */
  async alarm(): Promise<void> {
    await this.apply((s) => s);
  }

  // ---- WebSocket ------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return error("bad_request", "this endpoint is a WebSocket");
    }
    const state = this.load();
    if (!state) return error("not_found", "no such lobby");

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(this.message(state, Date.now()));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The only message is `hello`: it marks the socket's player as connected. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) return;
    let token: unknown;
    try {
      const parsed: unknown = JSON.parse(message);
      if (typeof parsed !== "object" || parsed === null || (parsed as { type?: unknown }).type !== "hello") return;
      token = (parsed as { token?: unknown }).token;
    } catch {
      return;
    }
    if (typeof token !== "string" || token === "") return;
    const player = await playerByToken(this.env.DB, token);
    if (!player) return;
    // Kept on the socket itself, so it survives hibernation.
    ws.serializeAttachment({ playerId: player.id } satisfies Attachment);
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (ws.deserializeAttachment()) this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (ws.deserializeAttachment()) this.broadcast(ws);
  }

  // ---- the shell ------------------------------------------------------------

  private load(): LobbyState | undefined {
    return this.ctx.storage.kv.get<LobbyState>(STATE);
  }

  private async apply(change: (state: LobbyState, now: number) => LobbyState): Promise<LobbyResult> {
    const before = this.load();
    if (!before) return { ok: false, code: "not_found", message: "no such lobby" };
    const now = Date.now();
    // Deadlines that passed before the alarm got here still apply first.
    let state = game.tick(before, now);
    let failed: LobbyResult | undefined;
    try {
      state = change(state, now);
    } catch (err) {
      failed = failure(err);
    }

    if (state !== before) {
      this.ctx.storage.kv.put(STATE, state);
      if (before.phase !== "finished" && state.phase === "finished") {
        const record = matchRecord(state);
        if (record) this.ctx.storage.kv.put(PENDING + record.matchId, record);
      }
      this.broadcast();
    }
    await this.flushPending();
    await this.arm();
    return failed ?? { ok: true, snapshot: this.view(state, now) };
  }

  /** Writes finished matches to D1. A failure leaves the marker in storage and
   *  `arm` schedules a retry, so a result is never lost. */
  private async flushPending(): Promise<void> {
    for (const [key, record] of this.ctx.storage.kv.list<MatchRecord>({ prefix: PENDING })) {
      try {
        await recordMatch(this.env.DB, record);
        this.ctx.storage.kv.delete(key);
      } catch (err) {
        console.error("match write failed; will retry", record.matchId, err);
      }
    }
  }

  /** The single alarm: the next game deadline, or a D1 retry if that is sooner. */
  private async arm(): Promise<void> {
    const state = this.load();
    let at = state ? game.nextAlarmAt(state) : null;
    for (const _ of this.ctx.storage.kv.list({ prefix: PENDING, limit: 1 })) {
      at = Math.min(at ?? Infinity, Date.now() + RETRY_MS);
    }
    if (at === null) await this.ctx.storage.deleteAlarm();
    else if ((await this.ctx.storage.getAlarm()) !== at) await this.ctx.storage.setAlarm(at);
  }

  /** `connected` comes from live sockets, never from stored state. */
  private view(state: LobbyState, now: number, closing?: WebSocket): LobbySnapshot {
    const connected = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (ws !== closing && attachment) connected.add(attachment.playerId);
    }
    return game.snapshot(state, now, CATALOG, connected);
  }

  private message(state: LobbyState, now: number, closing?: WebSocket): string {
    return JSON.stringify({ type: "state", state: this.view(state, now, closing) } satisfies ServerMessage);
  }

  private broadcast(closing?: WebSocket): void {
    const state = this.load();
    if (!state) return;
    const data = this.message(state, Date.now(), closing);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing) continue;
      try {
        ws.send(data);
      } catch {
        // The socket is on its way out; its close event follows.
      }
    }
  }
}

function failure(err: unknown): LobbyResult {
  if (err instanceof game.GameError) return { ok: false, code: err.code, message: err.message };
  throw err;
}
