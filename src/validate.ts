// Checking what clients send before the game acts on it. Pure.

import type { Difficulty, ErrorCode, LobbyConfig, SubmissionReport, TimerMode } from "./protocol.ts";
import { DIFFICULTIES, LIMITS } from "./protocol.ts";

/** A rule violation. The code goes to the client as-is. */
export class GameError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

const bad = (message: string): GameError => new GameError("bad_request", message);

/** Used when switching timer mode leaves the old limit out of range. */
export const DEFAULT_TIME_LIMIT_SEC: Record<TimerMode, number> = {
  per_question: 15 * 60,
  overall: 45 * 60,
};

const TIMER_MODES: readonly TimerMode[] = ["per_question", "overall"];
const CONFIG_KEYS = ["difficulties", "topics", "questionCount", "timerMode", "timeLimitSec", "includePaid"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;
}

/** Applies a partial config. Anything unknown or out of range is `bad_request`:
 *  nothing is clamped silently, except the time limit when the mode changes
 *  under it. */
export function applyConfigPatch(config: LobbyConfig, patch: unknown, knownTopics: ReadonlySet<string>): LobbyConfig {
  if (!isRecord(patch)) throw bad("config must be an object");
  for (const key of Object.keys(patch)) {
    if (!CONFIG_KEYS.includes(key)) throw bad(`unknown config field: ${key.slice(0, 40)}`);
  }
  const next: LobbyConfig = { ...config };

  if (patch.difficulties !== undefined) {
    const list = patch.difficulties;
    if (!Array.isArray(list) || list.length === 0) throw bad("difficulties must be a non-empty list");
    if (!list.every((d) => DIFFICULTIES.includes(d as Difficulty))) throw bad("unknown difficulty");
    next.difficulties = DIFFICULTIES.filter((d) => list.includes(d));
  }

  if (patch.topics !== undefined) {
    const list = patch.topics;
    if (!Array.isArray(list)) throw bad("topics must be a list");
    if (!list.every((t) => typeof t === "string" && knownTopics.has(t))) throw bad("unknown topic");
    next.topics = [...new Set(list as string[])];
  }

  if (patch.questionCount !== undefined) {
    const { min, max } = LIMITS.questionCount;
    if (!inRange(patch.questionCount, LIMITS.questionCount)) throw bad(`questionCount must be ${min}-${max}`);
    next.questionCount = patch.questionCount;
  }

  if (patch.includePaid !== undefined) {
    if (typeof patch.includePaid !== "boolean") throw bad("includePaid must be true or false");
    next.includePaid = patch.includePaid;
  }

  if (patch.timerMode !== undefined) {
    if (!TIMER_MODES.includes(patch.timerMode as TimerMode)) throw bad("unknown timerMode");
    next.timerMode = patch.timerMode as TimerMode;
  }

  const range = LIMITS.timeLimitSec[next.timerMode];
  if (patch.timeLimitSec !== undefined) {
    if (!inRange(patch.timeLimitSec, range)) throw bad(`timeLimitSec must be ${range.min}-${range.max} for ${next.timerMode}`);
    next.timeLimitSec = patch.timeLimitSec;
  } else if (!inRange(next.timeLimitSec, range)) {
    next.timeLimitSec = DEFAULT_TIME_LIMIT_SEC[next.timerMode];
  }

  return next;
}

export function sameConfig(a: LobbyConfig, b: LobbyConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const MAX_SLUG = 120;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_STATUS_MSG = 60;
const MAX_LANG = 30;

const countOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** Normalises a report from the extension, bounding everything that is stored. */
export function parseReport(body: unknown): SubmissionReport {
  if (!isRecord(body)) throw bad("report must be an object");
  const { slug, statusCode, statusMsg, lang, lcUsername } = body;
  // LeetCode's own ids are numbers; take one as readily as its string form.
  const submissionId = typeof body.submissionId === "number" ? String(body.submissionId) : body.submissionId;

  if (typeof slug !== "string" || slug.length === 0 || slug.length > MAX_SLUG) throw bad("slug is required");
  if (typeof submissionId !== "string" || !SUBMISSION_ID.test(submissionId)) throw bad("submissionId is required");
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode)) throw bad("statusCode must be an integer");

  return {
    slug,
    submissionId,
    statusCode,
    statusMsg: typeof statusMsg === "string" ? statusMsg.slice(0, MAX_STATUS_MSG) : "",
    totalCorrect: countOrNull(body.totalCorrect),
    totalTestcases: countOrNull(body.totalTestcases),
    lang: typeof lang === "string" ? lang.slice(0, MAX_LANG) : null,
    lcUsername: validLcUsername(lcUsername) ? lcUsername : null,
  };
}

export function validLcUsername(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value);
}
