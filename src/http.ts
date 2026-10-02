// Response and request helpers for the API.

import type { ApiError, ErrorCode } from "./protocol.ts";
import { GameError } from "./validate.ts";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  invite_required: 401,
  forbidden: 403,
  not_host: 403,
  not_in_lobby: 403,
  not_found: 404,
  conflict: 409,
  name_taken: 409,
  lobby_full: 409,
  wrong_phase: 409,
  not_enough_players: 409,
  not_enough_questions: 409,
  question_closed: 409,
};

/** public/_headers covers static files only, so the API sets these itself. */
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...headers } });
}

export function error(code: ErrorCode, message: string): Response {
  return json({ error: { code, message } } satisfies ApiError, STATUS[code]);
}

export function methodNotAllowed(allow: string): Response {
  const body: ApiError = { error: { code: "bad_request", message: `method not allowed; use ${allow}` } };
  return json(body, 405, { Allow: allow });
}

/** Far more than any body the API takes. */
const MAX_BODY_BYTES = 16 * 1024;

/** The parsed JSON body, or undefined when there is none. */
export async function readJson(request: Request): Promise<unknown> {
  if (!request.body) return undefined;
  // Read in chunks so an oversized body is dropped without being buffered.
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new GameError("bad_request", "request body too large");
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new GameError("bad_request", "request body is not valid JSON");
  }
}
