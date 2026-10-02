// extension/content/hook.js run inside a vm context that stands in for a
// leetcode.com page: a fake fetch, a fake XMLHttpRequest and a postMessage spy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../../extension/content/hook.js", import.meta.url), "utf8");
const ORIGIN = "https://leetcode.com";
const tick = () => new Promise((r) => setTimeout(r, 0));

function makePage(pathname = "/problems/two-sum/description/") {
  const posted = [];
  let next = { body: null, ok: true, throwJson: false, reject: false };

  class FakeXHR {
    constructor() {
      this.listeners = [];
      this.responseType = "";
      this.status = 200;
    }
    open(...args) {
      this.opened = args;
    }
    send() {
      this.sent = true;
    }
    addEventListener(type, fn) {
      if (type === "load") this.listeners.push(fn);
    }
    finish(body, status = 200) {
      this.status = status;
      this.responseText = typeof body === "string" ? body : JSON.stringify(body);
      this.response = body;
      for (const fn of this.listeners) fn();
    }
  }

  const nativeFetch = async () => {
    const { body, ok, throwJson, reject } = next;
    if (reject) throw new TypeError("Failed to fetch");
    const make = () => ({
      ok,
      status: ok ? 200 : 403,
      clone: make,
      json: async () => {
        if (throwJson) throw new SyntaxError("bad json");
        return body;
      },
    });
    return make();
  };

  const ctx = vm.createContext({
    URL,
    location: { href: ORIGIN + pathname, origin: ORIGIN, pathname },
    fetch: nativeFetch,
    XMLHttpRequest: FakeXHR,
    postMessage: (msg, origin) => {
      assert.equal(origin, ORIGIN, "messages are posted to the page's own origin");
      posted.push(JSON.parse(JSON.stringify(msg)));
    },
  });
  ctx.window = ctx;
  vm.runInContext(SRC, ctx);
  vm.runInContext(SRC, ctx); // injecting twice must not double-wrap

  return {
    ctx,
    posted,
    of: (type) => posted.filter((m) => m.type === type),
    async fetch(url, body, init = {}, flags = {}) {
      next = { body, ok: true, throwJson: false, reject: false, ...flags };
      let res, err;
      try {
        res = await ctx.fetch(url, init);
      } catch (e) {
        err = e;
      }
      await tick();
      await tick();
      return { res, err };
    },
    submit(slug, id, lang = "cpp") {
      const init = { method: "POST", body: JSON.stringify({ lang, question_id: "1", typed_code: "x" }) };
      return this.fetch(`/problems/${slug}/submit/`, { submission_id: id }, init);
    },
    check(id, body, version = "v2/") {
      return this.fetch(`/submissions/detail/${id}/${version}check/`, body);
    },
  };
}

// A final Accepted body as captured from the live site (v2).
const judged = (over = {}) => ({
  status_code: 10, lang: "cpp", run_success: true, status_runtime: "4 ms", memory: 14876000,
  question_id: "1", compare_result: "1".repeat(65), task_name: "judger.judgetask.Judge",
  finished: true, total_correct: 65, total_testcases: 65, pretty_lang: "C++",
  submission_id: "2156492751", status_msg: "Accepted", state: "SUCCESS", judger_status_code: 10,
  ...over,
});
const RUN_ID = "runcode_1790636380.0670998_wrHUY0p9zK";

test("v2 flow: one submit, one result, held while ai_state is unsettled", async () => {
  const p = makePage();
  const { res } = await p.submit("two-sum", 2156492751);
  assert.ok(res.ok, "the page still gets its response");
  assert.deepEqual(p.posted, [
    { type: "submit", slug: "two-sum", submissionId: "2156492751", lang: "cpp", source: "leetzone-hook" },
  ]);
  for (const state of ["PENDING", "STARTED", "RUNNING_TESTS"]) await p.check("2156492751", { state });
  await p.check("2156492751", judged({ ai_state: "PENDING" }));
  await p.check("2156492751", judged({ ai_state: "STARTED" }));
  assert.equal(p.of("result").length, 0, "tests passed but the AI check is still running");
  await p.check("2156492751", judged({ ai_state: "SUCCESS" }));
  assert.deepEqual(p.of("result"), [{
    type: "result", slug: "two-sum", submissionId: "2156492751", statusCode: 10, statusMsg: "Accepted",
    totalCorrect: 65, totalTestcases: 65, lang: "cpp", source: "leetzone-hook",
  }]);
});

test("duplicate check responses produce exactly one result", async () => {
  const p = makePage();
  await p.submit("two-sum", 2156492751);
  await p.submit("two-sum", 2156492751);
  await p.check("2156492751", judged());
  await p.check("2156492751", judged());
  await p.check("2156492751", judged(), "");
  await p.fetch(ORIGIN + "/submissions/detail/2156492751/v3/check/", judged());
  assert.equal(p.of("submit").length, 1);
  assert.equal(p.of("result").length, 1);
});

test("Run is ignored", async () => {
  const p = makePage();
  const run = { ...judged(), task_name: "judger.runcodetask.RunCode", submission_id: RUN_ID };
  await p.fetch("/problems/two-sum/interpret_solution/", { interpret_id: RUN_ID }, { method: "POST", body: "{}" });
  await p.check(RUN_ID, run, "");
  await p.check(RUN_ID, run);
  await p.check("12345", { ...run, submission_id: "12345" }, ""); // numeric id, RunCode task
  await p.check("12346", { ...judged(), submission_id: RUN_ID }, "");
  assert.deepEqual(p.posted, []);
});

test("compile error reports null counts", async () => {
  const p = makePage();
  await p.submit("a-b", 7, "python3");
  await p.check("7", {
    status_code: 20, lang: "python3", run_success: false, compile_error: "x", status_runtime: "N/A",
    task_name: "judger.judgetask.Judge", total_correct: null, total_testcases: null, compare_result: "",
    submission_id: "7", status_msg: "Compile Error", state: "SUCCESS",
  });
  const [m] = p.of("result");
  assert.deepEqual(
    [m.slug, m.statusCode, m.statusMsg, m.totalCorrect, m.totalTestcases, m.lang],
    ["a-b", 20, "Compile Error", null, null, "python3"],
  );
});

test("wrong answer, and counts derived from compare_result when missing", async () => {
  const p = makePage();
  await p.submit("a-b", 8);
  await p.check("8", judged({ status_code: 11, status_msg: "Wrong Answer", compare_result: "1101", total_correct: 3, total_testcases: 4 }));
  await p.submit("a-b", 9);
  await p.check("9", judged({ status_code: 11, status_msg: "Wrong Answer", compare_result: "1101", total_correct: undefined, total_testcases: undefined }));
  for (const m of p.of("result")) {
    assert.deepEqual([m.statusCode, m.statusMsg, m.totalCorrect, m.totalTestcases], [11, "Wrong Answer", 3, 4]);
  }
  assert.equal(p.of("result").length, 2);
});

test("status 10 with a failed case in compare_result is Wrong Answer", async () => {
  const p = makePage();
  await p.submit("two-sum", 10);
  await p.check("10", judged({ compare_result: "11011", total_correct: 4, total_testcases: 5 }));
  const [m] = p.of("result");
  assert.deepEqual([m.statusCode, m.statusMsg, m.totalCorrect, m.totalTestcases], [11, "Wrong Answer", 4, 5]);
});

test("restrictions failed (50) passes through as not accepted", async () => {
  const p = makePage();
  await p.submit("two-sum", 11);
  await p.check("11", judged({ status_code: 50, status_msg: "Restrictions Failed", ai_state: "SUCCESS" }));
  assert.equal(p.of("result")[0].statusCode, 50);
});

test("XMLHttpRequest path, text and json response types, non-2xx ignored", () => {
  const p = makePage();
  const xhr = (method, url, body, type = "") => {
    const x = new p.ctx.XMLHttpRequest();
    x.responseType = type;
    x.open(method, url);
    x.send(body);
    return x;
  };
  const s = xhr("POST", "/problems/two-sum/submit/", JSON.stringify({ lang: "java" }));
  s.finish({ submission_id: 55 });
  xhr("GET", "/submissions/detail/55/v2/check/").finish({ state: "PENDING" });
  xhr("GET", "/submissions/detail/55/v2/check/").finish("<html>", 403);
  xhr("GET", "/submissions/detail/55/v2/check/").finish("{not json");
  xhr("GET", "/submissions/detail/55/v2/check/", undefined, "json").finish(judged({ submission_id: "55", lang: undefined }));
  xhr("GET", "/submissions/detail/55/v2/check/").finish(judged({ submission_id: "55" }));
  assert.ok(s.sent, "the real send still runs");
  assert.deepEqual(s.opened, ["POST", "/problems/two-sum/submit/"]);
  assert.equal(p.of("submit").length, 1);
  assert.equal(p.of("result").length, 1);
  assert.equal(p.of("result")[0].lang, "java", "lang falls back to the submit body");
});

test("never disturbs the page: malformed JSON, non-ok, rejected fetch, odd inputs", async () => {
  const p = makePage();
  let r = await p.fetch("/problems/two-sum/submit/", null, { method: "POST", body: "{bad" }, { throwJson: true });
  assert.ok(r.res);
  r = await p.fetch("/problems/two-sum/submit/", { error: "nope" }, { method: "POST", body: "x" }, { ok: false });
  assert.equal(r.res.ok, false);
  r = await p.fetch("/problems/two-sum/submit/", { error: "rate limited" }, { method: "POST", body: "{}" });
  assert.ok(r.res.ok);
  r = await p.fetch("/submissions/detail/1/v2/check/", null, {}, { reject: true });
  assert.ok(r.err instanceof TypeError, "a rejection reaches the page unchanged");
  for (const input of [undefined, null, 42, {}, "/graphql/", "/problems/two-sum/"]) {
    r = await p.fetch(input, judged());
    assert.ok(r.res);
  }
  assert.deepEqual(p.posted, []);
});

test("cross-origin and contest URLs are ignored", async () => {
  const p = makePage();
  await p.fetch("https://evil.example/problems/two-sum/submit/", { submission_id: 5 });
  await p.fetch({ url: "https://evil.example/submissions/detail/5/v2/check/" }, judged({ submission_id: "5" }));
  await p.fetch("/contest/api/weekly-contest-1/problems/two-sum/submit/", { submission_id: 6 }, { method: "POST", body: "{}" });
  assert.deepEqual(p.posted, []);
  // A check with no observed submit is only trusted on a plain problem page.
  const contest = makePage("/contest/weekly-contest-1/problems/two-sum/");
  await contest.check("778", judged({ submission_id: "778" }));
  assert.deepEqual(contest.posted, []);
});

test("a check for an unobserved numeric id takes its slug from the page", async () => {
  const p = makePage("/problems/lru-cache/submissions/");
  await p.fetch({ url: ORIGIN + "/submissions/detail/777/v2/check/" }, judged({ submission_id: "777" }));
  assert.equal(p.of("result").length, 1);
  assert.equal(p.of("result")[0].slug, "lru-cache");
  await p.check("abc", judged({ submission_id: "abc" }));
  assert.equal(p.of("result").length, 1, "non-numeric unobserved ids are not submissions");
});

test("judge failure posts one error and no result", async () => {
  const p = makePage();
  await p.submit("two-sum", 900);
  await p.check("900", { state: "FAILURE" });
  await p.check("900", { state: "FAILURE" });
  await p.check("900", judged({ submission_id: "900" }));
  assert.equal(p.of("error").length, 1);
  assert.equal(p.of("result").length, 0);
});
