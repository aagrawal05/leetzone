// The action popup: who you are, which lobby, and a way back to the site.
// An extension page, so inline scripts are not allowed; hence this file.
const DEFAULT_SERVER = "https://leetzone.adityagrawal.com";
const PHASES = {
  lobby: "waiting for the host to start",
  countdown: "about to start",
  running: "match in progress",
  finished: "match finished",
};
const $ = (id) => document.getElementById(id);

async function load() {
  try {
    return (await chrome.storage.local.get("session")).session ?? null;
  } catch {
    return null;
  }
}

function render(session, lobbyLine, live) {
  const who = $("who");
  who.textContent = "";
  if (session) {
    const name = document.createElement("strong");
    name.textContent = session.player.name;
    who.append("Playing as ", name);
  } else {
    who.textContent = "Not connected yet.";
  }
  $("lobby").textContent = lobbyLine;
  $("lobby").classList.toggle("live", live);
  $("open").textContent = session?.lobbyCode ? `Open lobby ${session.lobbyCode}` : "Open LeetZone";
}

// Wired up before the snapshot round trip so the button never waits on it.
$("open").addEventListener("click", async () => {
  const s = await load();
  const server = s?.server ?? DEFAULT_SERVER;
  const url = s?.lobbyCode ? `${server}/l/${encodeURIComponent(s.lobbyCode)}` : `${server}/`;
  try {
    await chrome.tabs.create({ url }); // needs no "tabs" permission
  } catch {}
  window.close();
});

$("privacy").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await chrome.tabs.create({ url: `${DEFAULT_SERVER}/privacy` });
  } catch {}
  window.close();
});

const session = await load();
$("version").textContent = "v" + chrome.runtime.getManifest().version;

if (!session) {
  render(null, "Open LeetZone and pick a name. The extension picks up your session from the site.", false);
} else if (!session.lobbyCode) {
  render(session, "Not in a lobby. Create or join one on LeetZone.", false);
} else {
  render(session, `Lobby ${session.lobbyCode}`, false);
  const r = await chrome.runtime.sendMessage({ type: "snapshot" }).catch(() => null);
  if (r?.ok) {
    const phase = PHASES[r.snapshot.phase] ?? "";
    render(session, `Lobby ${session.lobbyCode} - ${phase}`, r.snapshot.phase === "running");
  } else if (!r || r.error === "network" || r.error === "server") {
    render(session, `Lobby ${session.lobbyCode} - cannot reach LeetZone`, false);
  } else {
    // The background has dropped whatever was stale; show what is left.
    const now = await load();
    render(now, now ? "Not in a lobby. Create or join one on LeetZone." : "Signed out. Open LeetZone to sign back in.", false);
  }
}
