# LeetZone

Competitive LeetCode with friends. Make a lobby, pick difficulty, topics, number
of questions and a clock, then race on leetcode.com itself. A browser extension
watches your real LeetCode submissions and scores them; the site shows the lobby,
the live scoreboard, and a leaderboard over time.

Hosted, unlisted, at https://leetzone.adityagrawal.com.

## How a match goes

1. Everyone installs the extension (below) and opens the site.
2. First visit: pick a name and enter the invite code.
3. One person creates a lobby and shares the 5-character code or the link.
4. The host sets difficulty, topics, question count and the clock, then starts.
5. After a 5 second countdown the question opens. Click through to LeetCode and
   solve it there as usual. A small panel on the LeetCode page shows the clock,
   the question and the scoreboard.
6. Every submission is scored as LeetCode judges it. The match ends on the
   clock, when everyone has solved everything, or when the host ends it.

Two clocks:

- **per question**: one question at a time, everyone together. The round ends
  when the time is up or everyone has solved it.
- **overall**: all questions open at once under one clock, in any order.

Scoring, per question (base 100 / 200 / 300 for Easy / Medium / Hard):

```
points = 0.5 * base * (test cases passed, 0..1)        accuracy
       + 0.5 * base * (time left when solved, 0..1)    speed
       - base * min(0.25, 0.05 * wrong submissions)    penalty
```

A first-try instant solve is worth the full base; a solve at the buzzer is
worth half; an unsolved question still earns up to half for test cases passed.
The constants are at the top of [`src/scoring.ts`](src/scoring.ts).

## Layout

| Path | What |
|---|---|
| `src/` | Cloudflare Worker: JSON API, the `Lobby` Durable Object, D1 queries |
| `src/protocol.ts` | The contract: every type the three parts exchange |
| `src/game.ts` | The whole game as a pure state machine (no I/O) |
| `public/` | The site: plain ES modules and one stylesheet, no build step |
| `extension/` | Chrome MV3 extension, plain JS, no build step |
| `migrations/` | D1 schema |
| `data/` | The bundled LeetCode problem catalog |
| `test/` | `node --test` suites for the game rules and the extension's detection |
| `docs/DESIGN.md` | The rules and the reasons behind the design |

No runtime dependencies. Dev dependencies are `wrangler` and `typescript`.

## Run it locally

Needs Node 24 or newer (the tests rely on Node running TypeScript directly).

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

The site is at http://localhost:8787. All state (lobbies and the stats
database) lives under `.wrangler/state`. Locally there is no invite code. To
play alone, put `MIN_PLAYERS=1` in a `.dev.vars` file.

```bash
npm test
```

```bash
npm run typecheck
```

## The extension

Chrome (or any Chromium browser), version 120 or newer.

Friends install it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/nomfblgjdallmehppjfblkheoioclkbj)
(the listing is unlisted: the link is the way in). For development, load the `extension/` folder unpacked: open
`chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and
choose `extension`. Then open LeetZone; the footer should say the extension is
connected.

The unpacked copy follows whichever LeetZone you are signed in to, production
or `localhost:8787`, with nothing to configure; the store build talks to
production only. After changing its files, press the reload button on its card
in `chrome://extensions` and refresh any open LeetCode tabs.

It asks for one permission, `storage`, and talks only to the LeetZone server.
`npm run ext:pack` builds the store upload into `dist/`; everything the store
dashboard asks for is in [`docs/STORE.md`](docs/STORE.md), and the privacy
policy is `public/privacy.html`. On leetcode.com it watches the page's own submit and result requests; it never
reads or sends your code.

## Deploy

One-time setup, with `wrangler login` done:

```bash
npx wrangler d1 create leetzone
```

Paste the printed `database_id` into the `d1_databases` entry in
`wrangler.jsonc`, then:

```bash
npm run db:migrate:remote
```

```bash
npx wrangler secret put INVITE_CODE
```

```bash
npm run deploy
```

`wrangler deploy` creates the `leetzone.adityagrawal.com` DNS record and
certificate itself. Afterwards, `npm run deploy` is the whole release; run
`npm run db:migrate:remote` first when there is a new file in `migrations/`.
A deploy drops open WebSockets; pages reconnect on their own within seconds.

Everything fits the Workers free plan for a group of friends.

## Upkeep

```bash
npm run sync:catalog
```

refreshes `data/problems.json` and `data/topics.json` from LeetCode's public
problem list. Run it now and then (new problems appear, free ones turn
Premium), commit the result, and deploy.

## Things to know

- **Trust.** Reports come from each player's own browser, so a determined
  friend can fake one. That is a deliberate trade for simplicity; see
  "Identity and access" in the design doc for where verification would go.
- **Unlisted, not private.** Reading is open to anyone with the URL. Creating
  a player needs the invite code, and everything else that writes needs a
  player's token.
- **Your token is your account.** It lives in the browser's local storage.
  Use "copy login link" under your name to sign in on another browser; do not
  share that link.
- **LeetCode can change.** The extension depends on two private LeetCode
  endpoints that have changed before. Everything about them is in
  [`extension/content/hook.js`](extension/content/hook.js) and
  [`extension/content/judge.js`](extension/content/judge.js), with tests in
  `test/extension/`.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with or endorsed by LeetCode;
`data/` holds only problem titles, numbers, difficulties and topic tags from
LeetCode's public problem list, never problem statements.
