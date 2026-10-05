// Isolated world, leetcode.com. The fallback for when hook.js saw a submit but
// the page's own polling never produced a verdict (the tab was reloaded, the
// page changed how it polls): ask LeetCode's check endpoint ourselves.
//
// The rules for reading a check response mirror hook.js, which cannot share
// code with this world.
"use strict";

const JUDGE_POLL_MS = 1500;
const JUDGE_MAX_MS = 120_000;

// A check response -> {final: verdict} | {failed: true} | null (still judging).
function readVerdict(json, fallbackLang) {
  if (!json || typeof json !== "object") return null;
  if (json.state === "FAILURE" || json.state === "REVOKED" || json.ai_state === "FAILURE") return { failed: true };
  if (json.state !== "SUCCESS" || json.ai_state === "PENDING" || json.ai_state === "STARTED") return null;
  if (!Number.isInteger(json.status_code)) return null;

  const compare = typeof json.compare_result === "string" ? json.compare_result : "";
  const int = (v) => (Number.isInteger(v) ? v : null);
  let totalCorrect = int(json.total_correct);
  let totalTestcases = int(json.total_testcases);
  if (totalTestcases === null && compare) {
    totalTestcases = compare.length;
    totalCorrect = compare.split("1").length - 1;
  }
  // 10 with a failed case is shown by LeetCode as Wrong Answer (11).
  const wrong = json.status_code === 10 && compare.includes("0");
  return {
    final: {
      statusCode: wrong ? 11 : json.status_code,
      statusMsg: wrong ? "Wrong Answer" : typeof json.status_msg === "string" ? json.status_msg : "",
      totalCorrect,
      totalTestcases,
      lang: (typeof json.lang === "string" && json.lang) || fallbackLang || null,
    },
  };
}

// Resolves to a verdict, or null when there is none to be had. `stopped()` lets
// the caller cancel once the hook delivers after all.
async function pollVerdict(id, fallbackLang, stopped, maxMs = JUDGE_MAX_MS, everyMs = JUDGE_POLL_MS) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const base = `/submissions/detail/${encodeURIComponent(id)}/`;
  let path = base + "v2/check/";
  let failures = 0;
  // v2 answers {"state": "PENDING"} forever for an id it does not know, so
  // the deadline is the only way out of that.
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline && !stopped()) {
    let res = null;
    let json = null;
    try {
      res = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (res.ok) json = await res.json();
    } catch {}
    if (stopped()) return null;
    if (res && (res.status === 404 || res.status === 403) && path.includes("/v2/")) {
      path = base + "check/"; // the legacy, unversioned form
      continue;
    }
    if (!json) {
      if (++failures >= 5) return null;
    } else {
      failures = 0;
      const verdict = readVerdict(json, fallbackLang);
      if (verdict) return verdict.final ?? null;
    }
    await sleep(res?.status === 429 ? everyMs * 4 : everyMs);
  }
  return null;
}
