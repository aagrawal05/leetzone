// Service worker. The only part of the extension that talks to the server.
//
// Chrome stops it after about 30 seconds idle, so nothing here is kept in
// memory: the session lives in chrome.storage.local and every message is
// answered from there.
//
// Messages (chrome.runtime.sendMessage):
//   {type: "session", session}   from site-bridge.js; null signs out
//   {type: "snapshot"}           from leetcode.js and the popup
//   {type: "report", report}     from leetcode.js; a SubmissionReport
// The last two answer {ok: true, snapshot} or {ok: false, error}, where error
// is the server's error code or one of the local ones below.

const SITE_ORIGINS = new Set([
  "https://leetzone.adityagrawal.com",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);
const LEETCODE_ORIGIN = "https://leetcode.com";
const SELF_ORIGIN = self.location.origin;
const FETCH_TIMEOUT_MS = 15_000;

const fail = (error) => ({ ok: false, error });
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

async function getSession() {
  return (await chrome.storage.local.get("session")).session ?? null;
}

// Validates what the page sent; `server` comes from the sender, never from here.
function cleanSession(s, server) {
  if (!s || typeof s !== "object") return null;
  const token = str(s.token, 512);
  const id = str(s.player?.id, 64);
  const name = str(s.player?.name, 64);
  if (!token || !id || !name) return null;
  const code = typeof s.lobbyCode === "string" && /^[A-Za-z0-9]{1,12}$/.test(s.lobbyCode) ? s.lobbyCode.toUpperCase() : null;
  return { server, token, player: { id, name }, lobbyCode: code };
}

async function setSession(raw, server) {
  const current = await getSession();
  if (raw == null) {
    // A signed-out local dev tab must not sign out production, or the reverse.
    if (current?.server === server) await chrome.storage.local.remove("session");
    return { ok: true };
  }
  const next = cleanSession(raw, server);
  if (!next) return fail("bad_request");
  // The site repeats itself; only a real change should wake storage listeners.
  if (JSON.stringify(next) !== JSON.stringify(current)) await chrome.storage.local.set({ session: next });
  return { ok: true };
}

// Drops the lobby (or the whole session) unless the session changed meanwhile.
async function forget(used, { lobbyOnly }) {
  const current = await getSession();
  if (!current || current.token !== used.token || current.server !== used.server) return;
  if (!lobbyOnly) await chrome.storage.local.remove("session");
  else if (current.lobbyCode === used.lobbyCode) await chrome.storage.local.set({ session: { ...current, lobbyCode: null } });
}

// `suffix` is a literal chosen here: content scripts never supply a URL or path.
async function lobbyRequest(suffix, body) {
  const session = await getSession();
  if (!session) return fail("no_session");
  if (!session.lobbyCode) return fail("no_lobby");
  if (!SITE_ORIGINS.has(session.server)) return fail("no_session");

  let res, data;
  try {
    res = await fetch(`${session.server}/api/lobbies/${encodeURIComponent(session.lobbyCode)}${suffix}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    data = await res.json().catch(() => null);
  } catch {
    return fail("network");
  }

  if (res.ok) return data && typeof data === "object" ? { ok: true, snapshot: data } : fail("server");
  const code = typeof data?.error?.code === "string" ? data.error.code : "";
  if (res.status === 401) await forget(session, { lobbyOnly: false });
  else if (res.status === 404 || (res.status === 403 && code === "not_in_lobby")) await forget(session, { lobbyOnly: true });
  if (res.status >= 500) return fail("server");
  return fail(code || `http_${res.status}`);
}

// Content scripts are less trusted than this worker: copy known fields only.
function cleanReport(r) {
  if (!r || typeof r !== "object") return null;
  const report = {
    slug: str(r.slug, 128),
    submissionId: str(r.submissionId, 64),
    statusCode: r.statusCode,
    statusMsg: str(r.statusMsg, 64),
    totalCorrect: count(r.totalCorrect),
    totalTestcases: count(r.totalTestcases),
    lang: str(r.lang, 32) || null,
  };
  return report.slug && report.submissionId && Number.isInteger(report.statusCode) ? report : null;
}

const handlers = {
  session: {
    from: SITE_ORIGINS,
    run: (msg, sender) => setSession(msg.session, sender.origin),
  },
  snapshot: {
    from: new Set([LEETCODE_ORIGIN, SELF_ORIGIN]),
    run: () => lobbyRequest(""),
  },
  report: {
    from: new Set([LEETCODE_ORIGIN]),
    run: (msg) => {
      const report = cleanReport(msg.report);
      return report ? lobbyRequest("/submissions", report) : Promise.resolve(fail("bad_request"));
    },
  },
};

function allowed(handler, sender) {
  if (sender.id !== chrome.runtime.id) return false;
  // Top frames only. A prerendered page's top frame has a non-zero frameId, and
  // the site does not repeat its session once that page is shown.
  if (sender.frameId && sender.documentLifecycle !== "prerender") return false;
  return handler.from.has(sender.origin);
}

// Registered synchronously at top level so a cold-started worker still gets
// the message that woke it.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = Object.hasOwn(handlers, msg?.type) ? handlers[msg.type] : null;
  if (!handler || !allowed(handler, sender)) {
    sendResponse(fail("forbidden"));
    return false;
  }
  handler.run(msg, sender).then(sendResponse, () => sendResponse(fail("internal")));
  return true; // keeps the channel, and the worker, alive until sendResponse runs
});
