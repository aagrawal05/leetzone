-- Long-term stats. Live lobby state lives in the Lobby Durable Object; a match
-- is written here exactly once, when it finishes.

CREATE TABLE players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- SHA-256 of the bearer token, hex. The token itself is never stored.
  token_hash  TEXT NOT NULL UNIQUE,
  lc_username TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE matches (
  id             TEXT PRIMARY KEY,
  lobby_code     TEXT NOT NULL,
  -- The LobbyConfig the match was played with, as JSON.
  config         TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  player_count   INTEGER NOT NULL,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER NOT NULL
);

CREATE INDEX matches_ended_at ON matches (ended_at);

-- One row per player per match: the final standing.
CREATE TABLE match_players (
  match_id    TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  player_id   TEXT NOT NULL REFERENCES players (id),
  score       INTEGER NOT NULL,
  -- 1 is first place; ties share a rank.
  rank        INTEGER NOT NULL,
  solved      INTEGER NOT NULL,
  submissions INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX match_players_player ON match_players (player_id);

-- One row per player per question: what the score was made of.
CREATE TABLE match_results (
  match_id       TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  player_id      TEXT NOT NULL REFERENCES players (id),
  question_index INTEGER NOT NULL,
  slug           TEXT NOT NULL,
  difficulty     TEXT NOT NULL,
  solved         INTEGER NOT NULL,
  time_ms        INTEGER,
  submissions    INTEGER NOT NULL,
  wrong          INTEGER NOT NULL,
  accuracy       REAL NOT NULL,
  points         INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id, question_index)
);

CREATE INDEX match_results_player ON match_results (player_id);
