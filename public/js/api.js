// One function per route in docs/DESIGN.md. Failures throw an ApiError carrying
// the server's {code, message} and the HTTP status; a request that never got an
// answer (offline, mid-deploy) throws with code "network".

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let getToken = () => null;
let onUnauthorized = () => {};

/** session.js supplies the token and what to do when the server rejects it. */
export function configure(opts) {
  getToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

async function request(method, path, body, token = getToken()) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("network", "Can't reach the server.", 0);
  }

  let data = null;
  try { data = await res.json(); } catch { /* not JSON: an HTML error page mid-deploy */ }

  if (res.ok && data !== null) return data;

  const code = data?.error?.code ?? (res.status >= 500 || res.ok ? "network" : "bad_request");
  const err = new ApiError(code, data?.error?.message ?? `Request failed (${res.status}).`, res.status);
  // invite_required is also a 401, but it is about the invite, not the token.
  if (res.status === 401 && code !== "invite_required" && token && token === getToken()) onUnauthorized();
  throw err;
}

const lobby = (code) => `/api/lobbies/${encodeURIComponent(code)}`;

export const api = {
  meta: () => request("GET", "/api/meta"),
  createPlayer: (name, invite) => request("POST", "/api/players", invite ? { name, invite } : { name }),
  me: (token) => request("GET", "/api/me", undefined, token),
  profile: (name) => request("GET", `/api/players/${encodeURIComponent(name)}`),
  leaderboard: () => request("GET", "/api/leaderboard"),

  createLobby: (config) => request("POST", "/api/lobbies", config ? { config } : {}),
  lobby: (code) => request("GET", lobby(code)),
  join: (code) => request("POST", `${lobby(code)}/join`),
  leave: (code) => request("POST", `${lobby(code)}/leave`),
  config: (code, patch) => request("PATCH", `${lobby(code)}/config`, patch),
  start: (code) => request("POST", `${lobby(code)}/start`),
  end: (code) => request("POST", `${lobby(code)}/end`),
  reset: (code) => request("POST", `${lobby(code)}/reset`),

  wsUrl: (code) => `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${lobby(code)}/ws`,
};

/** A sentence for a person, for every documented ErrorCode. */
export function explain(err) {
  switch (err?.code) {
    case "network": return "Can't reach the server. Try again in a moment.";
    case "unauthorized": return "You've been signed out. Enter your name to continue.";
    case "invite_required": return "That invite code isn't right.";
    case "name_taken": return "That name is taken. Pick another, or use your login link if it's yours.";
    case "lobby_full": return "This lobby is full.";
    case "wrong_phase": return "Too late for that: the match has moved on.";
    case "not_found": return "Nothing here by that name.";
    case "not_host": return "Only the host can do that.";
    case "not_in_lobby": return "You're not in this lobby.";
    case "not_enough_players": return "Not enough players to start yet.";
    case "not_enough_questions": return "Not enough matching problems. Loosen the filters or lower the question count.";
    case "question_closed": return "That question is closed.";
    case "forbidden": return "You're not allowed to do that.";
    case "conflict":
    case "bad_request": return err.message || "That didn't work.";
    default: return err?.message || "Something went wrong.";
  }
}
