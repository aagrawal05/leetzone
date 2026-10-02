// "/": the name form on first visit, then create or join a lobby.

import { api, explain } from "../api.js";
import * as session from "../session.js";
import { navigate } from "../app.js";
import { h, replace } from "../ui/dom.js";
import { num } from "../ui/format.js";

const CODE_CHARS = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;

/** Whatever was pasted, as a lobby code: upper case, no spaces or look-alikes. */
export const cleanCode = (raw) => raw.toUpperCase().replace(CODE_CHARS, "").slice(0, 5);

/** The sign-up form. Also used by the lobby view for visitors with no name yet. */
export function nameForm(lead = "Pick a name to play. No password: this browser remembers you.") {
  const name = h("input", { type: "text", name: "name", autocomplete: "nickname", maxlength: 20, required: true, spellcheck: "false", "aria-describedby": "name-hint" });
  const invite = h("input", { type: "text", name: "invite", autocomplete: "off", spellcheck: "false" });
  const inviteField = h("label.field", { hidden: true }, h("span", "invite code"), invite);
  const error = h("p.error", { role: "alert" });
  const submit = h("button.primary", { type: "submit" }, "continue");

  api.meta().then((meta) => { inviteField.hidden = !meta.inviteRequired; }, () => {});

  const form = h("form.stack.narrow", {
    onsubmit: async (event) => {
      event.preventDefault();
      const value = name.value.trim().replace(/\s+/g, " ");
      if (!/^[A-Za-z0-9 _-]{2,20}$/.test(value)) {
        error.textContent = "Names are 2–20 characters: letters, digits, spaces, _ and -.";
        return name.focus();
      }
      submit.disabled = true;
      error.textContent = "";
      try {
        const created = await api.createPlayer(value, invite.value.trim());
        session.signIn(created.token, created);
      } catch (err) {
        submit.disabled = false;
        if (err.code === "invite_required") {
          error.textContent = invite.value ? explain(err) : "This group needs an invite code. Ask whoever sent you the link.";
          inviteField.hidden = false;
          invite.focus();
        } else {
          error.textContent = explain(err);
          if (err.code === "name_taken" || err.code === "bad_request") name.select();
        }
      }
    },
  },
    h("p", lead),
    h("label.field", h("span", "name"), name, h("span", { id: "name-hint" }, "2–20 characters: letters, digits, spaces, _ and -")),
    inviteField,
    h("div.row", submit),
    error,
  );
  return form;
}

function play() {
  const error = h("p.error", { role: "alert" });
  const create = h("button.primary", {
    type: "button",
    onclick: async () => {
      create.disabled = true;
      error.textContent = "";
      try {
        const snapshot = await api.createLobby();
        navigate(`/l/${snapshot.code}`);
      } catch (err) {
        create.disabled = false;
        error.textContent = explain(err);
      }
    },
  }, "create lobby");

  const code = h("input.code-input", {
    type: "text", name: "code", "aria-label": "lobby code", placeholder: "CODE", autocomplete: "off",
    autocapitalize: "characters", spellcheck: "false", size: 7,
    oninput: () => {
      code.value = cleanCode(code.value);
      join.disabled = code.value.length !== 5;
    },
  });
  const join = h("button", { type: "submit", disabled: true }, "join");
  const joinForm = h("form.row", {
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = "";
      try {
        await api.join(code.value);
      } catch (err) {
        // A match under way or a full lobby can still be watched.
        if (err.code !== "wrong_phase" && err.code !== "lobby_full") {
          error.textContent = err.code === "not_found" ? `No lobby with the code ${code.value}.` : explain(err);
          return code.select();
        }
      }
      navigate(`/l/${code.value}`);
    },
  }, code, join);

  const current = session.currentLobby();
  return h("section",
    h("h2", "play"),
    current && h("p", "You're in lobby ", h("a", { href: `/l/${current}` }, current), ". ", h("a", { href: `/l/${current}` }, "Go back to it")),
    h("div.play",
      h("div.stack", h("p.muted.small", "Start a new match and share the code."), h("div.row", create)),
      h("div.stack", h("p.muted.small", "Or join one with a 5-character code."), joinForm),
    ),
    error,
  );
}

/** Returns {el, stop}. Keeps asking while the server cannot be reached. */
function topFive() {
  const body = h("div", h("p.muted.small", "loading"));
  let closed = false;
  let retry = 0;
  const load = () => api.leaderboard().then(({ rows }) => {
    if (closed) return;
    const top = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);
    if (!top.length) return replace(body, h("p.muted", "No matches played yet. Be the first."));
    const best = top[0].totalScore || 1;
    replace(body, h("ol.top5", top.map((row, i) => h("li",
      h("span.muted", i + 1),
      h("a", { href: `/p/${encodeURIComponent(row.name)}` }, row.name),
      h("span.bar", { "aria-hidden": "true" }, h("i", { style: `width:${Math.max(2, (row.totalScore / best) * 100)}%` })),
      h("span", num(row.totalScore)),
    ))));
  }, () => {
    if (closed) return;
    replace(body, h("p.muted.small.reconnecting", "Can't reach the server. Retrying"));
    retry = setTimeout(load, 4000);
  });
  load();

  const el = h("section",
    h("div.row.between", h("h2", "top players"), h("a.small", { href: "/leaderboard" }, "full leaderboard")),
    body,
  );
  return { el, stop: () => { closed = true; clearTimeout(retry); } };
}

export function mount(root) {
  document.title = "leetzone";
  const me = session.player();
  const top = topFive();
  if (!me) {
    replace(root,
      h("section", h("h1", "Race your friends on LeetCode."), h("p.muted", "Make a lobby, pick the difficulty and topics, and solve on leetcode.com. The extension reports your submissions; the scoreboard updates live.")),
      h("section", nameForm()),
      top.el,
    );
    root.querySelector("input")?.focus();
  } else {
    replace(root, play(), top.el);
  }
  return top.stop;
}
