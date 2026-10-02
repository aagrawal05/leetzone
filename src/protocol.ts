// The contract between the Worker, the site and the extension.
//
// Everything a client can send or receive is declared here. The site and the
// extension are plain JavaScript and cannot import this file, so docs/DESIGN.md
// mirrors it in prose; change both together.
//
// Types and constants only: nothing in this file may touch the Workers runtime,
// so it stays importable from `node --test`.

export type Difficulty = "Easy" | "Medium" | "Hard";
export const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Medium", "Hard"];

/** `per_question`: synchronized rounds, one question at a time, each with its
 *  own clock. `overall`: every question opens at once under a single clock. */
export type TimerMode = "per_question" | "overall";

export interface LobbyConfig {
  /** Non-empty. Questions are drawn uniformly from the union. */
  difficulties: Difficulty[];
  /** Topic slugs. A problem matches if it has any of them; empty means any topic. */
  topics: string[];
  questionCount: number;
  timerMode: TimerMode;
  /** Seconds per question, or for the whole match, depending on `timerMode`. */
  timeLimitSec: number;
  /** Include LeetCode Premium problems. Off by default: not everyone has Premium. */
  includePaid: boolean;
}

export const DEFAULT_CONFIG: LobbyConfig = {
  difficulties: ["Easy", "Medium"],
  topics: [],
  questionCount: 3,
  timerMode: "per_question",
  timeLimitSec: 15 * 60,
  includePaid: false,
};

export const LIMITS = {
  nameMin: 2,
  nameMax: 20,
  maxPlayers: 16,
  questionCount: { min: 1, max: 10 },
  timeLimitSec: {
    per_question: { min: 60, max: 60 * 60 },
    overall: { min: 5 * 60, max: 3 * 60 * 60 },
  },
  /** Pause before the match starts and between synchronized rounds. */
  countdownMs: 5_000,
  feedLength: 30,
} as const;

/** lobby -> countdown -> running -> (countdown -> running)* -> finished -> lobby (reset) */
export type Phase = "lobby" | "countdown" | "running" | "finished";

export interface Question {
  /** LeetCode's user-facing number, e.g. "1" for Two Sum. */
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  topics: string[];
}

export interface QuestionSnapshot extends Question {
  index: number;
  url: string;
  /** Epoch ms. Submissions count only while `openedAt <= now < closesAt`. */
  openedAt: number;
  closesAt: number;
}

export interface ScoreBreakdown {
  /** Partial credit for the best fraction of test cases passed. */
  accuracy: number;
  /** Bonus for solving early; zero unless solved. */
  speed: number;
  /** Subtracted for wrong submissions; reported as a positive number. */
  penalty: number;
}

export interface QuestionResult {
  solved: boolean;
  /** Ms from the question opening to the accepted submission. */
  timeMs: number | null;
  /** Judged submissions that counted (stops at the accepted one). */
  submissions: number;
  wrong: number;
  /** Best `totalCorrect / totalTestcases` so far, 0..1. 1 once solved. */
  accuracy: number;
  points: number;
  breakdown: ScoreBreakdown;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  /** Has the lobby page open right now. Informational only. */
  connected: boolean;
  /** Left mid-match: keeps their score but no longer blocks early round ends. */
  left: boolean;
  score: number;
  solved: number;
  /** Aligned with `LobbySnapshot.questions` (revealed questions only). */
  results: QuestionResult[];
}

export type FeedKind = "join" | "leave" | "start" | "round" | "solve" | "attempt" | "finish";

/** A transient happening, so clients can animate without diffing snapshots. */
export interface FeedItem {
  /** Increases by one per item within a lobby. */
  id: number;
  at: number;
  kind: FeedKind;
  playerId?: string;
  questionIndex?: number;
  points?: number;
}

/** The whole public state of a lobby. Pushed over the WebSocket on every change
 *  and returned by every lobby endpoint. Small enough to send whole. */
export interface LobbySnapshot {
  code: string;
  phase: Phase;
  hostId: string;
  config: LobbyConfig;
  /** How many catalog problems match `config` and are still unplayed in this lobby. */
  poolSize: number;
  /** Lobby: join order. Otherwise: by score, best first. */
  players: PlayerSnapshot[];
  matchId: string | null;
  /** Questions in this match, including ones not revealed yet. */
  questionCount: number;
  /** Revealed questions only: `per_question` hides future rounds. */
  questions: QuestionSnapshot[];
  /** Index of the current (running) or upcoming (countdown) question.
   *  Always 0 in `overall` mode. */
  round: number;
  /** Epoch ms when the current phase ends: the countdown, or the open
   *  question's deadline. Null in `lobby` and `finished`. */
  phaseEndsAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  feed: FeedItem[];
  /** Bumps on every change; clients drop snapshots older than the one they hold. */
  version: number;
  /** Server clock when this snapshot was built, for client clock offset. */
  now: number;
}

/** What the extension reports for each judged LeetCode submission. */
export interface SubmissionReport {
  slug: string;
  /** LeetCode's submission id. Reports are idempotent on it. */
  submissionId: string;
  /** LeetCode status_code; 10 is Accepted. */
  statusCode: number;
  statusMsg: string;
  /** Null when LeetCode gives no counts (e.g. compile errors). */
  totalCorrect: number | null;
  totalTestcases: number | null;
  lang: string | null;
  /** The reporter's LeetCode handle, kept as profile metadata. */
  lcUsername?: string | null;
}

export const LC_STATUS_ACCEPTED = 10;

export interface Player {
  id: string;
  name: string;
}

// ---- HTTP -----------------------------------------------------------------
// JSON in, JSON out. Authenticated routes take `Authorization: Bearer <token>`.
// Failures are `{ error: { code, message } }` with a matching HTTP status.

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invite_required"
  | "name_taken"
  | "lobby_full"
  | "wrong_phase"
  | "not_host"
  | "not_in_lobby"
  | "not_enough_players"
  | "not_enough_questions"
  | "question_closed";

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

/** POST /api/players  {name, invite?}  ->  the token is shown exactly once. */
export interface CreatePlayerResponse extends Player {
  token: string;
}

export interface TopicInfo {
  slug: string;
  name: string;
  count: number;
}

/** GET /api/meta: everything the lobby form needs to render itself. */
export interface MetaResponse {
  topics: TopicInfo[];
  limits: typeof LIMITS;
  defaults: LobbyConfig;
  minPlayers: number;
  inviteRequired: boolean;
}

export interface LeaderboardRow {
  playerId: string;
  name: string;
  matches: number;
  wins: number;
  totalScore: number;
  avgScore: number;
  solved: number;
  /** Mean per-question accuracy, 0..1. */
  accuracy: number;
  lastPlayedAt: number;
}

export interface MatchSummary {
  matchId: string;
  endedAt: number;
  playerCount: number;
  questionCount: number;
  score: number;
  rank: number;
  solved: number;
}

/** GET /api/players/:name */
export interface ProfileResponse {
  player: Player & { lcUsername: string | null; createdAt: number };
  totals: Omit<LeaderboardRow, "playerId" | "name">;
  /** Oldest first, for the score-over-time chart. */
  matches: MatchSummary[];
}

// ---- WebSocket ------------------------------------------------------------
// GET /api/lobbies/:code/ws. The server only ever pushes snapshots; every
// command goes over HTTP. Clients may send `hello` to show as connected, and
// the literal text "ping" (answered "pong") as a keepalive.

export type ServerMessage = { type: "state"; state: LobbySnapshot };
export type ClientMessage = { type: "hello"; token: string };
