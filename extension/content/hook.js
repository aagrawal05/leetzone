// MAIN world, document_start, leetcode.com.
//
// Watches the page's own submit and judge-poll traffic and tells leetcode.js
// about it with window.postMessage. It sends nothing itself, never changes a
// request or a response, and never throws into the page. Everything known about
// LeetCode's private endpoints lives in this file (and the fallback poll in
// leetcode.js); they have changed before.
//
// Messages, all tagged {source: "leetzone-hook"}:
//   {type: "submit", slug, submissionId, lang}       the submit call returned an id
//   {type: "result", slug, submissionId, statusCode, statusMsg,
//    totalCorrect, totalTestcases, lang}             the verdict is final; once per id
//   {type: "error",  slug, submissionId}             the judge failed; there is no verdict
(() => {
  "use strict";
  const FLAG = "__leetzoneHook";
  try {
    if (window[FLAG]) return;
    Object.defineProperty(window, FLAG, { value: true });
  } catch {
    return;
  }

  const SOURCE = "leetzone-hook";
  // Contest submits live under /contest/api/... and are deliberately not matched.
  const SUBMIT_RE = /^\/problems\/([a-z0-9][a-z0-9_-]*)\/submit\/?$/i;
  // /submissions/detail/<id>/check/ and /submissions/detail/<id>/vN/check/
  const CHECK_RE = /^\/submissions\/detail\/([^/]+)\/(?:v\d+\/)?check\/?$/i;
  // "Run" polls the same check URL with ids like runcode_<time>_<rand>.
  const RUN_ID_RE = /^(?:runcode|interpret)/i;
  const PAGE_SLUG_RE = /^\/problems\/([a-z0-9][a-z0-9_-]*)(?:\/|$)/i;
  const ACCEPTED = 10;
  const WRONG_ANSWER = 11;

  const pending = new Map(); // submissionId -> {slug, lang}
  let done = new Set(); // submissionIds already reported
  const noop = () => {};

  function post(msg) {
    try {
      msg.source = SOURCE;
      window.postMessage(msg, window.location.origin);
    } catch {}
  }

  function classify(rawUrl) {
    try {
      if (rawUrl == null) return null;
      const u = new URL(String(rawUrl), window.location.href);
      if (u.origin !== window.location.origin) return null;
      let m = SUBMIT_RE.exec(u.pathname);
      if (m) return { kind: "submit", slug: m[1].toLowerCase() };
      m = CHECK_RE.exec(u.pathname);
      if (m) {
        const id = decodeURIComponent(m[1]);
        return RUN_ID_RE.test(id) ? null : { kind: "check", id };
      }
    } catch {}
    return null;
  }

  function num(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
    return null;
  }

  function onSubmit(slug, reqBody, json) {
    if (!json || typeof json !== "object" || json.submission_id == null) return;
    const id = String(json.submission_id);
    if (RUN_ID_RE.test(id) || pending.has(id) || done.has(id)) return;
    let lang = null;
    try {
      const body = typeof reqBody === "string" ? JSON.parse(reqBody) : null;
      if (body && typeof body.lang === "string") lang = body.lang;
    } catch {}
    pending.set(id, { slug, lang });
    post({ type: "submit", slug, submissionId: id, lang });
  }

  function settle(id) {
    pending.delete(id);
    done.add(id);
    if (done.size > 500) done = new Set(Array.from(done).slice(-250));
  }

  function onCheck(id, json) {
    if (!json || typeof json !== "object" || done.has(id)) return;
    const sent = pending.get(id);
    // A check for an id we never saw submitted (the page was reloaded while
    // judging) still counts, but only if it looks like a real submission.
    if (!sent && !/^\d+$/.test(id)) return;
    if (typeof json.task_name === "string" && /runcode|interpret/i.test(json.task_name)) return;
    if (json.submission_id != null && RUN_ID_RE.test(String(json.submission_id))) return;

    let slug = sent ? sent.slug : null;
    if (!slug) {
      const m = PAGE_SLUG_RE.exec(window.location.pathname); // not on /contest/...
      if (!m) return;
      slug = m[1].toLowerCase();
    }

    const state = json.state;
    const ai = json.ai_state; // v2 only; absent when the problem has no AI check
    if (state === "FAILURE" || state === "REVOKED" || ai === "FAILURE") {
      settle(id);
      post({ type: "error", slug, submissionId: id });
      return;
    }
    if (state !== "SUCCESS") return; // PENDING, STARTED, COMPILING, RUNNING_TESTS...
    // Tests are done but the AI check can still overturn the verdict.
    if (ai === "PENDING" || ai === "STARTED") return;
    let statusCode = num(json.status_code);
    if (statusCode === null) return;

    settle(id);
    const compare = typeof json.compare_result === "string" ? json.compare_result : "";
    let statusMsg = typeof json.status_msg === "string" ? json.status_msg : "";
    let totalCorrect = num(json.total_correct);
    let totalTestcases = num(json.total_testcases);
    if (totalTestcases === null && compare) {
      // The site itself derives the counts from compare_result.
      totalTestcases = compare.length;
      totalCorrect = compare.split("1").length - 1;
    }
    if (statusCode === ACCEPTED && compare.includes("0")) {
      // The site shows this as Wrong Answer; so do we.
      statusCode = WRONG_ANSWER;
      statusMsg = "Wrong Answer";
    }
    post({
      type: "result",
      slug,
      submissionId: id,
      statusCode,
      statusMsg,
      totalCorrect, // null for a compile error
      totalTestcases,
      lang: (typeof json.lang === "string" && json.lang) || (sent ? sent.lang : null),
    });
  }

  function dispatch(c, reqBody, json) {
    try {
      if (c.kind === "submit") onSubmit(c.slug, reqBody, json);
      else onCheck(c.id, json);
    } catch {}
  }

  try {
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function fetch(input, init) {
        const p = origFetch.apply(this, arguments);
        try {
          const url =
            typeof input === "string" ? input
            : input && typeof input.url === "string" ? input.url
            : input != null ? String(input)
            : null;
          const c = classify(url);
          if (c && p && typeof p.then === "function") {
            const reqBody = c.kind === "submit" && init && typeof init.body === "string" ? init.body : null;
            // Reads a clone; the page gets the untouched promise and response.
            p.then((res) => {
              try {
                if (!res || !res.ok || typeof res.clone !== "function") return;
                res.clone().json().then((json) => dispatch(c, reqBody, json), noop);
              } catch {}
            }, noop);
          }
        } catch {}
        return p;
      };
    }
  } catch {}

  try {
    const XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XP && typeof XP.open === "function" && typeof XP.send === "function") {
      const origOpen = XP.open;
      const origSend = XP.send;
      const urls = new WeakMap();
      XP.open = function open(method, url) {
        try {
          urls.set(this, url == null ? null : String(url));
        } catch {}
        return origOpen.apply(this, arguments);
      };
      XP.send = function send(body) {
        try {
          const c = classify(urls.get(this));
          if (c) {
            const xhr = this;
            const reqBody = c.kind === "submit" && typeof body === "string" ? body : null;
            xhr.addEventListener("load", () => {
              try {
                if (xhr.status < 200 || xhr.status >= 300) return;
                const rt = xhr.responseType;
                let json = null;
                if (rt === "" || rt === "text") json = JSON.parse(xhr.responseText);
                else if (rt === "json") json = xhr.response;
                if (json) dispatch(c, reqBody, json);
              } catch {}
            });
          }
        } catch {}
        return origSend.apply(this, arguments);
      };
    }
  } catch {}
})();
