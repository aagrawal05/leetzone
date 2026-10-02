// A live connection to one lobby. The WebSocket only ever delivers whole
// snapshots; HTTP is the fallback (on reconnect, on tab focus) and the channel
// for commands, whose responses are fed back in through accept().

import { api } from "./api.js";
import { token } from "./session.js";

const PING_MS = 25_000;
const BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

/** onSnapshot(snapshot) for each newer snapshot; onStatus("connecting" | "live"
 *  | "reconnecting" | "missing") as the link changes. */
export function connect(code, { onSnapshot, onStatus }) {
  let ws = null;
  let closed = false;
  let attempts = 0;
  let retryTimer = 0;
  let pingTimer = 0;
  let held = null;
  let offset = 0;
  let status = "";

  function setStatus(next) {
    if (closed || next === status) return;
    status = next;
    onStatus(next);
  }

  function accept(snapshot) {
    if (closed || !snapshot || typeof snapshot.version !== "number") return;
    if (held && snapshot.version < held.version) return;
    // Server clock minus ours, measured at receipt. Latency makes it a little
    // low, which only ever makes a timer run a fraction of a second generous.
    offset = snapshot.now - Date.now();
    held = snapshot;
    onSnapshot(snapshot);
  }

  async function refetch() {
    try {
      accept(await api.lobby(code));
    } catch (err) {
      if (err.code === "not_found") { setStatus("missing"); close(); }
      else if (!held) setStatus("reconnecting");
    }
  }

  function open() {
    if (closed) return;
    clearTimeout(retryTimer);
    setStatus(held ? "reconnecting" : "connecting");
    refetch();
    try { ws = new WebSocket(api.wsUrl(code)); } catch { return retry(); }
    const socket = ws;

    socket.onopen = () => {
      attempts = 0;
      setStatus("live");
      hello();
      pingTimer = setInterval(() => socket.readyState === 1 && socket.send("ping"), PING_MS);
    };
    socket.onmessage = (event) => {
      if (event.data === "pong") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === "state") accept(message.state);
    };
    socket.onclose = () => {
      clearInterval(pingTimer);
      if (ws === socket) { ws = null; retry(); }
    };
    socket.onerror = () => socket.close();
  }

  function retry() {
    if (closed) return;
    setStatus("reconnecting");
    const base = BACKOFF_MS[Math.min(attempts++, BACKOFF_MS.length - 1)];
    retryTimer = setTimeout(open, base * (0.75 + Math.random() * 0.5));
  }

  /** Tell the server who this socket belongs to, so the player shows as connected. */
  function hello() {
    if (ws?.readyState === 1 && token()) ws.send(JSON.stringify({ type: "hello", token: token() }));
  }

  function onVisible() {
    if (document.visibilityState !== "visible" || closed) return;
    if (ws) refetch();
    else { attempts = 0; open(); }
  }

  function close() {
    closed = true;
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    ws?.close();
    ws = null;
  }

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  open();

  return {
    accept,
    hello,
    close,
    /** The server's clock, as best we know it. */
    now: () => Date.now() + offset,
  };
}
