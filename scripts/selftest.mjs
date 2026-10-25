#!/usr/bin/env node
// selftest.mjs — 日报/爆炸去重的回归自测（无网络、无 LLM）
// 2026-10-25 立：V4.1 Flash 旧公告反复推的三层根因，各留一条断言，防止以后改回去。
import assert from "node:assert/strict";
import { parseHtml, parseDateText } from "./fetch-sources.mjs";
import { buildHotCandidates, seenFromLibrary, normKey, normTitle, loadState } from "./summarize.mjs";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const src = { name: "DeepSeek", id: "deepseek", kind: "company", priority: 1, host: "官方", url: "https://www.deepseek.com/news" };

test("parseHtml 能取 <a><h2> 卡片的链接与中文日期", () => {
  const html = `<a class="ds-news-hero-card" href="/news/deepseek-v4-1-flash/">
    <p><span>动态</span><span>2026 年 9 月 10 日</span></p>
    <h2>DeepSeek V4.1 Flash：更强、更快、更普惠</h2>
    <p>DeepSeek V4.1 Flash 正式发布。</p></a>`;
  const items = parseHtml(html, src);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://www.deepseek.com/news/deepseek-v4-1-flash/");
  assert.equal(items[0].published_at.slice(0, 10), "2026-09-10");
});

test("parseHtml 不再收无链接标题", () => {
  const html = `<h2>DeepSeek V4.1 Flash：更强、更快、更普惠</h2>`;
  assert.equal(parseHtml(html, src).length, 0);
});

test("parseDateText 支持中文/英文日期", () => {
  assert.equal(parseDateText("2026 年 9 月 10 日").slice(0, 10), "2026-09-10");
  assert.equal(parseDateText("Oct 24, 2026").slice(0, 10), "2026-10-24");
  assert.equal(parseDateText("24 Oct 2026").slice(0, 10), "2026-10-24");
});

test("hot 候选：无 url/无时间的老公告（V4.1）直接剔除", () => {
  const now = Date.now();
  const items = [
    { title: "DeepSeek V4.1 Flash：更强、更快、更普惠", url: "", published_at: "" },
    { title: "DeepSeek V4.1 Flash：更强、更快、更普惠", url: "https://www.deepseek.com/news/deepseek-v4-1-flash/", published_at: new Date(now - 40 * 86400000).toISOString() },
    { title: "某公司发布新模型", url: "https://example.com/new", published_at: new Date(now - 2 * 3600000).toISOString() },
  ];
  const out = buildHotCandidates(items, { now });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "某公司发布新模型");
});

test("hot 候选：近 30 天库内已报标题不再进池", () => {
  const seen = seenFromLibrary(30);
  assert.equal(seen.titles.has(normKey("DeepSeek V4.1 Flash：更强、更快、更普惠")), true);
});

test("hot 候选：已报过的标题即使有 url/新时间也剔除", () => {
  const now = Date.now();
  const seen = { titles: new Set([normKey("某公司发布新模型")]), urls: new Set() };
  const items = [{ title: "某公司发布新模型", url: "https://example.com/new", published_at: new Date(now - 3600000).toISOString() }];
  assert.equal(buildHotCandidates(items, { now, seen }).length, 0);
});

test("state/pushed.json 已种入 V4.1 永久键", () => {
  const s = loadState();
  assert.equal(s.ever.some(e => e.key === normTitle("DeepSeek V4.1 Flash：更强、更快、更普惠")), true);
});

if (!process.exitCode) console.log(`\nPASS ${passed} 项`);
