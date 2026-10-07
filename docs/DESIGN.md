# LeetZone design

Competitive LeetCode for a group of friends: make a lobby, pick difficulty,
topics, question count and a clock, then race on leetcode.com itself. A browser
extension watches your real LeetCode submissions and reports them; the site
shows the lobby, the live scoreboard and long-term stats.

The types in [`src/protocol.ts`](../src/protocol.ts) are the contract. This
document explains the rules behind them. Change both together.

## Shape

```
 leetcode.com tab                      leetzone.adityagrawal.com
┌──────────────────────┐              ┌──────────────────────────────┐
│ hook.js (MAIN world) │              │ Worker (src/index.ts)        │
│   sees submit/check  │              │   /api/*  JSON over HTTP     │
│ leetcode.js + HUD    │─ background ─▶   static site from public/   │
└──────────────────────┘   HTTP only  │        │                     │
 site tab                             │        ▼                     │
┌──────────────────────┐   HTTP + WS  │ Lobby Durable Object         │
│ public/ (no build)   │─────────────▶│   one per lobby code         │
│ site-bridge.js (ext) │              │   state, alarms, WebSockets  │
└──────────────────────┘              │        │ on match end        │
                                      │        ▼                     │
                                      │ D1: players, matches, results│
                                      └──────────────────────────────┘
```

Three parts, three directories, no shared build:

| Directory | What | Runtime |
|---|---|---|
| `src/` | Worker + `Lobby` Durable Object, TypeScript | Cloudflare Workers (`wrangler dev` locally) |
| `public/` | The site: plain ES modules and one stylesheet | Served as static assets by the Worker |
| `extension/` | Chrome MV3 extension, plain JS | Loaded unpacked |

Two principles hold the design together:

1. **Commands go over HTTP; state comes back as one snapshot.** Every lobby
   endpoint returns the full `LobbySnapshot`, and the WebSocket only ever pushes
   that same snapshot. Clients render from the latest snapshot and never patch
   local state. The extension has no socket at all: it polls the snapshot.
2. **The game is a pure state machine.** `src/game.ts` takes a state, an input
   and the current time, and returns the next state. It does no I/O, so
   `node --test` covers every rule. The Durable Object is a thin shell around
   it: load, apply, save, set the alarm, broadcast.

## Identity and access

- A player is a display name plus a bearer token. `POST /api/players` creates
  the player and returns the token once; the site keeps it in `localStorage`.
  D1 stores only the SHA-256 of the token.
- Names are unique, case-insensitively, 2–20 characters of `[A-Za-z0-9 _-]`,
  trimmed, no leading/trailing or doubled spaces.
- Creating a player needs the shared invite code when the `INVITE_CODE` secret
  is set. With it unset (local dev) the gate is open. Everything else that
  writes needs a valid token, so the invite code gates all writes.
- Reading is open to anyone who knows the URL: lobby snapshots (the lobby code
  is the capability), the leaderboard, profiles.
- A login link `/#token=<token>` signs another device in as the same player.
  The site reads it, verifies it with `GET /api/me`, stores it and strips the
  fragment from the URL.
  It is refused while a different player is signed in, so a link cannot swap
  someone's account out from under them. The link is the credential, and the
  browser keeps it in history after the fragment is stripped: treat it like a
  password and use it only on your own devices.
- Submission reports are trusted. This is a game between friends; the hook can
  be bypassed by anyone determined to. `SubmissionReport.submissionId` leaves
  room to verify against LeetCode later.

## A lobby's life

```
lobby ──start──▶ countdown ──alarm──▶ running ──deadline / all solved──┐
  ▲                  ▲                                                 │
  │                  └────── more rounds (per_question only) ──────────┤
  └──reset── finished ◀──────────── last round, or host ends ──────────┘
```

- **lobby.** Players join with the code. The host (the creator) edits the
  config; everyone sees it live, along with `poolSize`, the number of catalog
  problems that match and have not been played in this lobby yet. The host
  starts once at least `MIN_PLAYERS` are in and `poolSize >= questionCount`. If the host leaves, the longest-present player
  becomes host; when the last player leaves the lobby stays, empty, and the
  next player to join becomes host.
- **countdown.** 5 seconds. Nothing is revealed yet. Used before the match and
  between synchronized rounds, so everyone opens each question together.
- **running.**
  - `per_question`: one question is open. The round ends at its deadline, or
    as soon as every player who has not left has solved it. Then a countdown,
    then the next question; after the last one the match finishes.
  - `overall`: all questions open at once under one deadline. The match ends
    at the deadline, or when every player who has not left has solved them all.
- **finished.** Final standings. Written to D1 once. The host can `reset` to
  go back to `lobby` with the same players and config for another match.
  Questions already played in this lobby are not picked again.

Joining is only possible in `lobby`. Leaving mid-match keeps the player on the
scoreboard, marked `left`, and stops them from holding up a round; they may
`join` again to take their own seat back. The host can end the match early at
any point after `lobby`. `reset` drops players who left.

Questions are drawn at `start`, uniformly at random and without replacement,
from catalog problems whose difficulty is in `config.difficulties`, that have
at least one of `config.topics` (or any topic if empty), and that are free
unless `includePaid`. In `per_question` mode a snapshot only contains questions
up to the current round, so nobody can read ahead.

Timers are server-side: the Durable Object sets one alarm for `phaseEndsAt`.
Clients draw clocks from `phaseEndsAt` corrected by the offset between
`snapshot.now` and their own clock.

## Scoring

Per question, per player. All three inputs the brief asks for are separate,
visible terms (`ScoreBreakdown`), so the UI can show where points came from.

```
base      = { Easy: 100, Medium: 200, Hard: 300 }[difficulty]
accuracy  = best totalCorrect / totalTestcases over the player's submissions
            (1 once accepted; 0 for a submission with no test counts)
speed     = solved ? 1 - timeMs / limitMs : 0        clamped to 0..1
wrong     = judged submissions that were not accepted

accuracy points = 0.5 * base * accuracy
speed points    = 0.5 * base * speed
penalty         = base * min(0.25, 0.05 * wrong)
points          = max(0, round(accuracy points + speed points - penalty))
```

- `timeMs` runs from the question's `openedAt` to the server receiving the
  accepted report. `limitMs` is `timeLimitSec * 1000`: the round length in
  `per_question`, the match length in `overall`.
- An instant, first-try solve earns the full `base`. A solve at the buzzer
  earns half. Five or more wrong submissions cost a quarter.
- An unsolved question still earns up to half of `base` for test cases passed.
- A submission counts only for an open question in the running match, from a
  player in it, and only once per player and `submissionId`. After a player solves a
  question, further submissions to it are ignored.
- Match score is the sum. Standings sort by score, then questions solved, then
  total solve time (lower first), then name. Equal score, solved and time share
  a rank.

The constants live at the top of `src/scoring.ts`.

## HTTP API

JSON bodies. `Bearer` routes take `Authorization: Bearer <token>`. Errors are
`{ "error": { "code", "message" } }` with the status shown.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/meta` | – | | `MetaResponse` |
| POST | `/api/players` | invite | `{name, invite?}` | `CreatePlayerResponse` (201) |
| GET | `/api/me` | Bearer | | `Player` |
| GET | `/api/players/:name` | – | | `ProfileResponse` |
| GET | `/api/leaderboard` | – | | `{rows: LeaderboardRow[]}` |
| POST | `/api/lobbies` | Bearer | `{config?}` | `LobbySnapshot` (201), caller is host and joined |
| GET | `/api/lobbies/:code` | – | | `LobbySnapshot` |
| GET | `/api/lobbies/:code/ws` | – | | WebSocket upgrade |
| POST | `/api/lobbies/:code/join` | Bearer | | `LobbySnapshot` |
| POST | `/api/lobbies/:code/leave` | Bearer | | `LobbySnapshot` |
| PATCH | `/api/lobbies/:code/config` | Bearer, host | partial `LobbyConfig` | `LobbySnapshot` |
| POST | `/api/lobbies/:code/start` | Bearer, host | | `LobbySnapshot` |
| POST | `/api/lobbies/:code/end` | Bearer, host | | `LobbySnapshot` |
| POST | `/api/lobbies/:code/reset` | Bearer, host | | `LobbySnapshot` |
| POST | `/api/lobbies/:code/submissions` | Bearer | `SubmissionReport` | `LobbySnapshot` |

Status codes: `bad_request` 400, `unauthorized` 401, `invite_required` 401,
`forbidden` / `not_host` / `not_in_lobby` 403, `not_found` 404, and 409 for
`conflict`, `name_taken`, `lobby_full`, `wrong_phase`, `not_enough_players`,
`not_enough_questions`, `question_closed`. Two cases fall outside `ErrorCode`:
a wrong method on a known path is 405 with code `bad_request` and an `Allow`
header, and an unexpected failure is 500 with code `internal`.

Lobby codes are 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no
look-alikes), matched case-insensitively; a code nobody created is `not_found`
on every lobby route. `join` is idempotent. A report for an unknown or closed
question, or outside `running`, is `question_closed`; a `submissionId` the same
player already reported returns the current snapshot unchanged.

No CORS headers. The site is same-origin, and the extension's service worker
has host permission for the LeetZone origins, so its requests are not subject
to CORS. Auth is a bearer token, never a cookie, so there is nothing for a
cross-site page to ride on.

Every response, static or API, carries `X-Robots-Tag: noindex, nofollow`, and
`robots.txt` disallows everything: the site stays out of search engines.

## WebSocket

`GET /api/lobbies/:code/ws` upgrades to a socket that pushes
`{type: "state", state}` on connect and after every change. A client may send
`{type: "hello", token}` to be shown as `connected`. A `connected` change is
pushed without bumping `version`, so clients drop only strictly older
snapshots. The text `ping` is answered `pong` without waking the object. Sockets hibernate; the object holds
no in-memory state it cannot rebuild from storage.

## D1

See [`migrations/0001_init.sql`](../migrations/0001_init.sql): `players`,
`matches`, `match_players` (final standing per player), `match_results` (per
question). A finished match is written in one batch, keyed by `matchId`, with
`INSERT OR IGNORE`, so a retried write cannot double-count. A match with nobody
in it, or where nobody submitted anything, is not recorded.

Leaderboard and profile totals are computed from these tables on read. A win is
rank 1 with a score above zero in a match with at least two players.

## Site (`public/`)

No framework, no build. Path routes with SPA fallback:

| Route | View |
|---|---|
| `/` | Name / invite on first visit, then create a lobby or join by code; recent leaderboard |
| `/l/:code` | The lobby: renders whichever phase the snapshot says |
| `/leaderboard` | All-time table, sortable, with a bar for the sorted column |
| `/p/:name` | Profile: totals and score over time |

The lobby view opens the WebSocket, reconnects with backoff, and falls back to
re-fetching the snapshot when the tab becomes visible. Each phase is a pure
`render(snapshot)`.

Look: monospace, lots of whitespace, system light/dark, one accent colour, in
keeping with adityagrawal.com. Motion is purposeful and short: the countdown,
a draining timer that turns urgent near the end, scores that count up, rows
that slide when ranks change, a flash when someone solves. All of it is off
under `prefers-reduced-motion`.

All user-supplied text (names) is inserted with `textContent`, never as HTML.

## Extension (`extension/`)

Chrome MV3, no build. Permissions: `storage`, and host access to the LeetZone
origins (production and `localhost:8787`). Content scripts live in
`extension/content/`.

| File | World | Job |
|---|---|---|
| `hook.js` | leetcode.com, MAIN | Wraps `fetch` / `XMLHttpRequest`; posts one message per judged submission |
| `leetcode.js` | leetcode.com, isolated | Forwards submissions to the background; draws the HUD |
| `site-bridge.js` | LeetZone site, isolated | Copies the site's session into extension storage; tells the site the extension is there |
| `background.js` | service worker | The only place that talks to the server |
| `popup.html` | action popup | Who you are, which lobby, a link back to the site |

Session flow: the site owns identity. Messages are `window.postMessage` to the
page's own origin, tagged by `source`:

| From | Message | Meaning |
|---|---|---|
| site | `{source: "leetzone-site", type: "ping"}` | Is the extension there? |
| site | `{source: "leetzone-site", type: "session", session}` | `session` is `{token, player: {id, name}, lobbyCode}`, or `null` when signed out. `lobbyCode` is the lobby the player is currently in, or `null`. |
| ext | `{source: "leetzone-ext", type: "hello", version}` | Sent on load and in reply to `ping`. The site answers with `session`. |

`site-bridge.js` also sets `document.documentElement.dataset.leetzoneExt` to the
extension version at `document_start`, so the site can tell synchronously
whether the extension is installed. The background stores the session in
`chrome.storage.local` together with the server origin, which it takes from the
sender's origin, never from the message, so production and local dev need no
setting. Both sides check `event.source === window` and `event.origin`.

Detecting a submission: LeetCode's page calls `POST /problems/<slug>/submit/`,
gets `{submission_id}`, then polls `GET /submissions/detail/<id>/v2/check/`
until `state` is `SUCCESS` (and `ai_state`, when present, has settled).
`hook.js` wraps `fetch` and `XMLHttpRequest`, matches those two URLs (any
`/vN/`, and the legacy unversioned form), ignores "Run" (`runcode_` /
`interpret_` ids), and posts exactly one `result` per submission id. If the
page's own polling never yields a verdict, `leetcode.js` polls the check URL
itself for a while. A submission still being judged is remembered in the tab's
`sessionStorage`, so a reload or a full navigation mid-judging resumes it
instead of losing it. A verdict of 10 whose `compare_result` contains a failed
case is reported as Wrong Answer, as the site itself shows it. These endpoints
are private and have changed before; everything about them is in `hook.js`.

On leetcode.com, while a session with a lobby exists, `leetcode.js` polls the
snapshot through the background (every 2 s during countdown/running, slower
otherwise, paused while the tab is hidden) and renders a small draggable HUD in
a shadow root: the clock, the current question with a link to it, your score,
and a compact scoreboard. A judged submission is posted immediately and the
HUD updates from the response.

## Extending

- A new scoring rule: `src/scoring.ts`, plus a term in `ScoreBreakdown`.
- A new lobby option: add it to `LobbyConfig`, validate it in `src/game.ts`,
  give it a control in `public/`. Nothing else needs to know.
- A new game mode: a new `TimerMode` and its transitions in `src/game.ts`.
- Verifying submissions: check `submissionId` against LeetCode in the Worker
  before applying a report.

## Catalog

`npm run sync:catalog` downloads LeetCode's algorithm problems (about 3,650)
from its public GraphQL endpoint into `data/problems.json` and
`data/topics.json`, which are committed and bundled into the Worker. The Worker
never calls LeetCode at runtime. Re-run it now and then: new problems appear
and free ones turn Premium.
