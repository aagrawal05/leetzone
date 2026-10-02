#!/usr/bin/env node
// Downloads the LeetCode problem catalog (unauthenticated GraphQL) and writes
//   <outDir>/problems.json  [{id, slug, title, difficulty, paid, topics:[slug,...]}]
//   <outDir>/topics.json    [{slug, name, count}]   (count = problems in problems.json)
// Usage: node sync-catalog.mjs [outDir=./data] [--free-only] [--category=algorithms]
// Node >= 18 (global fetch). No dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? './data');
const freeOnly = args.includes('--free-only');
const category = (args.find((a) => a.startsWith('--category=')) ?? '--category=algorithms').split('=')[1];

const ENDPOINT = 'https://leetcode.com/graphql';
const PAGE = 100; // server silently clamps limit to 100; skip MUST be a multiple of limit
const QUERY = `query q($categorySlug:String,$limit:Int,$skip:Int,$filters:QuestionListFilterInput){
  problemsetQuestionList:questionList(categorySlug:$categorySlug,limit:$limit,skip:$skip,filters:$filters){
    total:totalNum
    questions:data{frontendQuestionId:questionFrontendId title titleSlug difficulty paidOnly:isPaidOnly topicTags{name slug}}
  }
}`;
const HEADERS = {
  'content-type': 'application/json', // required: without it Django answers a CSRF 403 page
  referer: 'https://leetcode.com/problemset/',
  'user-agent': 'Mozilla/5.0',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(skip, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ query: QUERY, variables: { categorySlug: category, skip, limit: PAGE, filters: {} } }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} cf-mitigated=${res.headers.get('cf-mitigated')} ${text.slice(0, 120)}`);
      const json = JSON.parse(text);
      if (json.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 200)}`);
      const list = json.data?.problemsetQuestionList;
      if (!list || !Array.isArray(list.questions)) throw new Error('unexpected response shape');
      return list;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(500 * 2 ** i);
    }
  }
  throw new Error(`page skip=${skip} failed after ${attempts} attempts: ${lastErr?.message}`);
}

const started = Date.now();
const bySlug = new Map();
let total = Infinity;
for (let skip = 0; skip < total; skip += PAGE) {
  const page = await fetchPage(skip);
  total = page.total;
  for (const q of page.questions) bySlug.set(q.titleSlug, q);
  if (page.questions.length === 0) break;
}
if (!Number.isFinite(total) || total === 0) throw new Error(`category "${category}" returned no problems`);
if (bySlug.size !== total) throw new Error(`catalog incomplete: got ${bySlug.size} unique, server says ${total}`);

const topicMap = new Map();
const problems = [...bySlug.values()]
  .filter((q) => !(freeOnly && q.paidOnly))
  .map((q) => {
    for (const t of q.topicTags) {
      const e = topicMap.get(t.slug) ?? { slug: t.slug, name: t.name, count: 0 };
      e.count++;
      topicMap.set(t.slug, e);
    }
    return {
      id: Number(q.frontendQuestionId),
      slug: q.titleSlug,
      title: q.title,
      difficulty: q.difficulty, // "Easy" | "Medium" | "Hard"
      paid: q.paidOnly,
      topics: q.topicTags.map((t) => t.slug),
    };
  })
  .sort((a, b) => a.id - b.id);
const topics = [...topicMap.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));

mkdirSync(outDir, { recursive: true });
const pJson = JSON.stringify(problems);
const tJson = JSON.stringify(topics);
writeFileSync(join(outDir, 'problems.json'), pJson);
writeFileSync(join(outDir, 'topics.json'), tJson);
console.log(
  `catalog: category=${category} freeOnly=${freeOnly} server total=${total} written=${problems.length} ` +
    `topics=${topics.length} problems.json=${Buffer.byteLength(pJson)}B topics.json=${Buffer.byteLength(tJson)}B ` +
    `in ${Date.now() - started}ms -> ${outDir}`,
);
