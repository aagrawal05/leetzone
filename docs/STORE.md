# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste. The upload is
`dist/leetzone-<version>.zip`, built by `npm run ext:pack` (it drops the dev
`key` and the localhost origins from `extension/manifest.json`). Images are in
`store/`.

## Package

| Field | Value |
|---|---|
| Upload | `dist/leetzone-1.0.0.zip` |
| Visibility | **Unlisted**: installable by anyone with the link, not searchable. Matches the unlisted site. |
| Regions | All |
| Pricing | Free |

## Store listing tab

**Name** (from the manifest): LeetZone

**Summary** (from the manifest, 118 of 132 characters):

> Competitive LeetCode with friends. Reports your LeetCode submissions to your LeetZone lobby and shows the match clock.

**Description:**

```
LeetZone turns LeetCode into a race between friends.

Make a lobby on leetzone.adityagrawal.com, pick the difficulty, topics, number of questions and the clock, and share the code. When the match starts, everyone solves the same real LeetCode problems on leetcode.com. This extension watches your submissions there and scores them as LeetCode judges them: faster solves, fewer wrong attempts and more test cases passed earn more points. The scoreboard updates live for everyone.

On a LeetCode problem page, a small panel shows the match clock, the current question and the scoreboard. Drag it anywhere or fold it away.

- Per-question rounds or one clock for the whole match
- Easy, Medium and Hard, any LeetCode topics, 1 to 10 questions
- Points for accuracy and speed, minus a penalty for wrong submissions
- A leaderboard and score history across matches

What it reads: only the results LeetCode returns for your own submissions (problem, verdict, test cases passed, language). It never reads or sends your code, and it talks only to the LeetZone server. Privacy policy: https://leetzone.adityagrawal.com/privacy

LeetZone is an independent project and is not affiliated with or endorsed by LeetCode.
```

**Category:** Education (alternative: Developer Tools)

**Language:** English

**Images:**

| Slot | File |
|---|---|
| Store icon (128x128) | `store/icon-128.png` |
| Screenshots (1280x800, up to 5) | `store/screenshot-1.png` ... `screenshot-5.png` |
| Small promo tile (440x280) | `store/promo-small-440x280.png` |
| Marquee promo tile (1400x560, optional) | `store/promo-marquee-1400x560.png` |

**Official URL:** none. **Homepage URL:** https://leetzone.adityagrawal.com/ .
**Support URL:** https://leetzone.adityagrawal.com/privacy (it carries the contact address).

## Privacy practices tab

**Single purpose:**

```
Scores your LeetCode submissions in a LeetZone match with friends: it reads the verdict LeetCode returns for each of your submissions on leetcode.com, sends it to your LeetZone lobby, and shows the match clock and scoreboard on the problem page.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the player's LeetZone session (display name, login token, current lobby), copied from the LeetZone site, so the extension can report on the player's behalf; also remembers where the player put the on-page panel. |
| Host permission `https://leetzone.adityagrawal.com/*` | The LeetZone server. The background script sends each judged submission result to the player's lobby and fetches the live scoreboard from this one origin only. A content script on this origin picks up the player's session when they sign in. |
| Content scripts on `https://leetcode.com/*` | Reads the verdict LeetCode returns for the player's own submissions (by observing the page's submit and result responses) and shows the match clock and scoreboard on problem pages. Registered on all of leetcode.com because LeetCode navigates between pages without reloading, so a script that only matched problem URLs would miss problems opened from other pages. |

**Remote code:** No, I am not using remote code. (All scripts are in the package; the server only returns JSON.)

**Data usage, what is collected:**

| Category | Collected | What |
|---|---|---|
| Personally identifiable information | Yes | The display name the player chose on LeetZone, kept in extension storage. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | Yes | The LeetZone login token, sent to the LeetZone server with each report. |
| Personal communications | No | |
| Location | No | |
| Web history | No | |
| User activity | Yes | It observes the page's own submit and result network responses on leetcode.com, for the player's submissions only. |
| Website content | Yes | The verdict of each submission: problem, status, test cases passed, language, submission number. |

**Certifications** (tick all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://leetzone.adityagrawal.com/privacy

## Test instructions (for the reviewer)

```
LeetZone needs an invite code to create a player. Invite code: <paste the INVITE_CODE here>

1. Install the extension and open https://leetzone.adityagrawal.com
2. Enter any name and the invite code, then click "create lobby". The site footer shows "extension connected".
3. Open any problem on https://leetcode.com/problems/ - the LeetZone panel appears with the lobby.
4. To play a match, open the lobby link in a second browser profile, create a second player, and press "start match" in the first. Submit a solution on the picked problem: the panel and the site scoreboard update with the verdict.
```

The invite code is a secret shared with friends; paste it into the dashboard
yourself and do not commit it here.

## Updating later

Bump `version` in `extension/manifest.json`, run `npm run ext:pack`, and upload
the new zip under the item's **Package** tab. Updates go through review again.
