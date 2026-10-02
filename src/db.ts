// Every D1 query. Schema: migrations/0001_init.sql.

import type { LeaderboardRow, MatchSummary, Player, ProfileResponse } from "./protocol.ts";
import type { MatchRecord } from "./snapshot.ts";

/** Hex SHA-256. Only this ever reaches the database, never the token. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Null when the name is taken (names are unique, case-insensitively). */
export async function createPlayer(db: D1Database, player: Player, token: string, now: number): Promise<Player | null> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO players (id, name, token_hash, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(player.id, player.name, await hashToken(token), now)
    .run();
  return result.meta.changes > 0 ? player : null;
}

export async function playerByToken(db: D1Database, token: string): Promise<Player | null> {
  return db
    .prepare("SELECT id, name FROM players WHERE token_hash = ?1")
    .bind(await hashToken(token))
    .first<Player>();
}

export async function setLcUsername(db: D1Database, playerId: string, lcUsername: string): Promise<void> {
  await db
    .prepare("UPDATE players SET lc_username = ?2 WHERE id = ?1 AND lc_username IS NOT ?2")
    .bind(playerId, lcUsername)
    .run();
}

/** One batch, which D1 runs as a transaction, and INSERT OR IGNORE throughout:
 *  writing the same match twice changes nothing. */
export async function recordMatch(db: D1Database, match: MatchRecord): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO matches (id, lobby_code, config, question_count, player_count, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        match.matchId,
        match.lobbyCode,
        JSON.stringify(match.config),
        match.questionCount,
        match.players.length,
        match.startedAt,
        match.endedAt,
      ),
  ];
  const insertPlayer = db.prepare(
    `INSERT OR IGNORE INTO match_players (match_id, player_id, score, rank, solved, submissions)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  );
  const insertResult = db.prepare(
    `INSERT OR IGNORE INTO match_results
       (match_id, player_id, question_index, slug, difficulty, solved, time_ms, submissions, wrong, accuracy, points)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  );
  for (const p of match.players) {
    statements.push(insertPlayer.bind(match.matchId, p.playerId, p.score, p.rank, p.solved, p.submissions));
    for (const r of p.results) {
      statements.push(
        insertResult.bind(
          match.matchId,
          p.playerId,
          r.questionIndex,
          r.slug,
          r.difficulty,
          r.solved ? 1 : 0,
          r.timeMs,
          r.submissions,
          r.wrong,
          r.accuracy,
          r.points,
        ),
      );
    }
  }
  await db.batch(statements);
}

// Totals are computed on read. A win is rank 1 in a match with at least two players.
const TOTALS = `
  SELECT p.id AS playerId, p.name AS name,
         COUNT(*) AS matches,
         SUM(CASE WHEN mp.rank = 1 AND m.player_count >= 2 THEN 1 ELSE 0 END) AS wins,
         SUM(mp.score) AS totalScore,
         AVG(mp.score) AS avgScore,
         SUM(mp.solved) AS solved,
         COALESCE((SELECT AVG(r.accuracy) FROM match_results r WHERE r.player_id = p.id), 0) AS accuracy,
         MAX(m.ended_at) AS lastPlayedAt
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  JOIN players p ON p.id = mp.player_id`;

const LEADERBOARD_ROWS = 100;

/** Players with at least one recorded match, best total first. */
export async function leaderboard(db: D1Database): Promise<LeaderboardRow[]> {
  const { results } = await db
    .prepare(`${TOTALS} GROUP BY p.id ORDER BY totalScore DESC, wins DESC, p.name LIMIT ?1`)
    .bind(LEADERBOARD_ROWS)
    .all<LeaderboardRow>();
  return results;
}

interface PlayerRow extends Player {
  lcUsername: string | null;
  createdAt: number;
}

export async function profile(db: D1Database, name: string): Promise<ProfileResponse | null> {
  const player = await db
    .prepare("SELECT id, name, lc_username AS lcUsername, created_at AS createdAt FROM players WHERE name = ?1")
    .bind(name)
    .first<PlayerRow>();
  if (!player) return null;

  const [totals, matches] = await db.batch<LeaderboardRow | MatchSummary>([
    db.prepare(`${TOTALS} WHERE p.id = ?1 GROUP BY p.id`).bind(player.id),
    db
      .prepare(
        `SELECT m.id AS matchId, m.ended_at AS endedAt, m.player_count AS playerCount,
                m.question_count AS questionCount, mp.score AS score, mp.rank AS rank, mp.solved AS solved
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ?1 ORDER BY m.ended_at, m.id`,
      )
      .bind(player.id),
  ]);

  const row = totals?.results[0] as LeaderboardRow | undefined;
  return {
    player,
    totals: {
      matches: row?.matches ?? 0,
      wins: row?.wins ?? 0,
      totalScore: row?.totalScore ?? 0,
      avgScore: row?.avgScore ?? 0,
      solved: row?.solved ?? 0,
      accuracy: row?.accuracy ?? 0,
      lastPlayedAt: row?.lastPlayedAt ?? 0,
    },
    matches: (matches?.results ?? []) as MatchSummary[],
  };
}
