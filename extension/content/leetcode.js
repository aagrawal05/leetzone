// Isolated world, document_start, leetcode.com, top frame. Loaded after
// judge.js, hud-model.js, hud-style.js and hud.js, which share this world.
//
// Two jobs: turn hook.js messages into SubmissionReports for the background,
// and keep the HUD showing the lobby the site put this player in.
(() => {
  "use strict";
  if (window.top !== window) return;

  const HOOK_GRACE_MS = 6000; // how long the page's own polling gets before ours starts
  const PENDING_KEY = "leetzone.pending"; // sessionStorage: this tab's submissions still being judged
  const REPORT_RETRY_MS = [1000, 2000, 4000, 8000];
  // The lobby poll is shorter than the 5 s countdown, so a tab waiting here
  // always sees the countdown before the first question opens.
  const POLL_MS = { countdown: 2000, running: 2000, lobby: 4000, finished: 10_000 };
  const TICK_MS = 250;

  let dead = false;
  let session = null; // {server, token, player, lobbyCode} from chrome.storage.local
  let snapshot = null;
  let clockOffset = 0; // server time minus ours, as of the snapshot's receipt
  let offline = false;
  let hud = null;
  let layout = null;
  let slug = pageSlug(location.pathname);
  let pollTimer = 0;
  let tickTimer = 0;
  let urlTimer = 0;
  let observer = null;
  let lcUsername; // the LeetCode handle: undefined until asked for, null until known
  const tracked = new Map(); // submissionId -> {slug, lang, at, timer, settled}

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const serverNow = () => Date.now() + clockOffset;
  const inLobby = () => !!session?.lobbyCode;

  // ---- extension context --------------------------------------------------
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  // The extension was reloaded or removed and this script is orphaned: go quiet.
  function teardown() {
    if (dead) return;
    dead = true;
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    clearInterval(urlTimer);
    for (const t of tracked.values()) clearTimeout(t.timer);
    observer?.disconnect();
    window.removeEventListener("message", onHookMessage);
    document.removeEventListener("visibilitychange", onVisibility);
    window.navigation?.removeEventListener("currententrychange", onUrl);
    hud?.destroy();
  }
  async function send(msg) {
    if (dead) return null;
    if (!alive()) return teardown(), null;
    try {
      return (await chrome.runtime.sendMessage(msg)) ?? null;
    } catch {
      if (!alive()) teardown(); // "Extension context invalidated."
      return null; // otherwise the worker restarted mid-request; callers retry
    }
  }
  function store(items) {
    try {
      chrome.storage.local.set(items).catch(() => {});
    } catch {}
  }

  // ---- submissions --------------------------------------------------------
  // Profile metadata only: looked up once per page, and never waited for.
  function askLcUsername() {
    if (lcUsername !== undefined) return;
    lcUsername = null;
    fetchLcUsername().then((name) => (lcUsername = name));
  }

  // What is still being judged is kept per tab, so that a reload or a full
  // navigation (the HUD's own links) before the verdict can pick it up again.
  function savePending() {
    const list = [];
    for (const [id, t] of tracked) if (t.at && !t.settled) list.push({ id, slug: t.slug, lang: t.lang, at: t.at });
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch {}
  }
  function resumePending() {
    let list = null;
    try {
      list = JSON.parse(sessionStorage.getItem(PENDING_KEY));
    } catch {}
    for (const p of Array.isArray(list) ? list : []) {
      if (typeof p?.id !== "string" || !/^\d{1,32}$/.test(p.id) || typeof p.slug !== "string") continue;
      const age = Date.now() - p.at;
      if (tracked.has(p.id) || typeof p.at !== "number" || !(age >= 0 && age < JUDGE_MAX_MS)) continue;
      const t = { slug: p.slug, lang: typeof p.lang === "string" ? p.lang : null, at: p.at, timer: 0, settled: false };
      tracked.set(p.id, t);
      askLcUsername();
      watch(p.id, t, 0); // the page that was polling for it is gone
    }
    savePending();
  }
  // Asks LeetCode ourselves, `after` ms from now, unless the hook delivers first.
  function watch(id, t, after) {
    clearTimeout(t.timer);
    t.timer = setTimeout(async () => {
      const verdict = await pollVerdict(id, t.lang, () => dead || t.settled, t.at + JUDGE_MAX_MS - Date.now());
      if (verdict) settle(id, t, verdict);
    }, after);
  }

  function onHookMessage(event) {
    if (dead || event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== "leetzone-hook") return;
    const id = msg.submissionId;
    if (typeof id !== "string" || !/^\d{1,32}$/.test(id) || typeof msg.slug !== "string") return;
    if (!inLobby()) return;

    let t = tracked.get(id);
    if (!t) tracked.set(id, (t = { slug: msg.slug, lang: msg.lang ?? null, timer: 0, settled: false }));
    if (t.settled) return;

    if (msg.type === "submit") {
      askLcUsername();
      t.at = Date.now();
      watch(id, t, HOOK_GRACE_MS);
      savePending();
    } else if (msg.type === "result" && Number.isInteger(msg.statusCode)) {
      settle(id, t, msg);
    } else if (msg.type === "error") {
      t.settled = true;
      clearTimeout(t.timer);
      savePending();
    }
  }

  async function settle(id, t, verdict) {
    if (t.settled) return;
    t.settled = true;
    clearTimeout(t.timer);
    savePending();
    const count = (v) => (Number.isInteger(v) ? v : null);
    const report = {
      slug: t.slug,
      submissionId: id,
      statusCode: verdict.statusCode,
      statusMsg: typeof verdict.statusMsg === "string" ? verdict.statusMsg : "",
      totalCorrect: count(verdict.totalCorrect),
      totalTestcases: count(verdict.totalTestcases),
      lang: typeof verdict.lang === "string" ? verdict.lang : t.lang,
      lcUsername: lcUsername ?? null,
    };
    const before = snapshot;
    // Reports are idempotent on submissionId, so a blip is worth retrying.
    for (let attempt = 0; !dead; attempt++) {
      const r = await send({ type: "report", report });
      if (r?.ok) {
        apply(r.snapshot);
        const f = flashFor(report, before, r.snapshot, session?.player.id);
        hud?.flash(f.good ? "good" : "bad", f.text);
        return;
      }
      const transient = !r || r.error === "network" || r.error === "server";
      if (!transient || attempt >= REPORT_RETRY_MS.length) {
        if (transient) hud?.flash("quiet", "Could not reach LeetZone - not counted");
        else if (snapshot?.phase === "running" && (r.error === "question_closed" || r.error === "wrong_phase")) hud?.flash("quiet", "Not an open match question - not counted");
        return;
      }
      setOffline(true);
      await sleep(REPORT_RETRY_MS[attempt]);
    }
  }

  // ---- snapshot polling ---------------------------------------------------
  function apply(next) {
    if (dead || !next || typeof next !== "object" || !Array.isArray(next.players) || !Array.isArray(next.questions)) return;
    offline = false;
    // Never step back to an older snapshot of the same lobby.
    if (snapshot && snapshot.code === next.code && next.version < snapshot.version) return render();
    snapshot = next;
    clockOffset = next.now - Date.now();
    render();
  }
  function setOffline(on) {
    if (offline === on) return;
    offline = on;
    render();
  }
  async function refresh() {
    clearTimeout(pollTimer);
    if (dead || !inLobby() || document.hidden) return;
    const r = await send({ type: "snapshot" });
    if (dead) return;
    if (r?.ok) apply(r.snapshot);
    else if (!r || r.error === "network" || r.error === "server") setOffline(true);
    schedule();
  }
  function schedule() {
    clearTimeout(pollTimer);
    if (dead || !inLobby() || document.hidden) return;
    const every = snapshot ? POLL_MS[snapshot.phase] : POLL_MS.running;
    if (every) pollTimer = setTimeout(refresh, every);
  }
  function onVisibility() {
    if (!document.hidden) refresh();
    else clearTimeout(pollTimer);
    syncTick();
  }

  // ---- HUD ----------------------------------------------------------------
  function mount() {
    if (dead || !document.documentElement) return;
    hud ??= createHud({ onGo, onLayout });
    if (!hud.host.isConnected) {
      document.documentElement.append(hud.host);
      hud.setLayout(layout);
    }
    if (!observer) {
      // The SPA (or hydration) may drop unknown children of <html>: put it back.
      observer = new MutationObserver(() => {
        if (!dead && inLobby() && snapshot && hud && !hud.host.isConnected) mount();
      });
      observer.observe(document.documentElement, { childList: true });
    }
  }
  function render() {
    if (dead) return;
    if (!inLobby() || !snapshot) {
      hud?.host.remove();
      return syncTick();
    }
    mount();
    const lobbyUrl = `${session.server}/l/${encodeURIComponent(snapshot.code)}`;
    hud.render(hudModel(snapshot, session.player.id, slug, serverNow()), { lobbyUrl, offline });
    tick();
    syncTick();
  }
  function tick() {
    if (snapshot?.phaseEndsAt != null) hud?.tick(snapshot.phaseEndsAt - serverNow());
  }
  function syncTick() {
    const want = !dead && !document.hidden && !!hud?.host.isConnected && (snapshot?.phase === "countdown" || snapshot?.phase === "running");
    if (want === !!tickTimer) return;
    if (want) tickTimer = setInterval(tick, TICK_MS);
    else {
      clearInterval(tickTimer);
      tickTimer = 0;
    }
  }
  function onGo(target) {
    if (target !== slug) location.assign(`https://leetcode.com/problems/${target}/`);
  }
  function onLayout(next) {
    layout = next;
    store({ hud: next });
  }

  // ---- session and URL changes --------------------------------------------
  function setSession(next) {
    const changed = next?.lobbyCode !== session?.lobbyCode || next?.server !== session?.server || next?.player?.id !== session?.player?.id;
    session = next?.token && next.player ? next : null;
    if (!changed) return;
    snapshot = null;
    offline = false;
    render();
    refresh();
  }
  function onUrl() {
    if (dead) return;
    if (!alive()) return teardown();
    const now = pageSlug(location.pathname);
    if (now === slug) return;
    slug = now;
    render();
  }

  async function start() {
    try {
      const saved = await chrome.storage.local.get(["session", "hud"]);
      layout = saved.hud ?? null;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!dead && area === "local" && changes.session) setSession(changes.session.newValue ?? null);
      });
      setSession(saved.session ?? null);
      if (inLobby()) resumePending();
    } catch {
      return teardown();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.navigation?.addEventListener("currententrychange", onUrl);
    urlTimer = setInterval(onUrl, 1000); // also notices an invalidated context on idle tabs
  }

  // Listen from document_start so no verdict is missed; draw only after parsing,
  // so the HUD never sits between <html> and <head> during hydration.
  window.addEventListener("message", onHookMessage);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
