#!/usr/bin/env node
// fetch-sources.mjs — 抓取全部信息源，输出统一格式 data/raw.json
// 零依赖：Node 18+ 内置 fetch。密钥环境变量：无（全部公开源）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const OUT = path.join(DATA_DIR, "raw.json");

// ============ 源配置 ============
// kind: company(公司官方) / trend(趋势社区) / media(媒体) / radar(聚合雷达)
const SOURCES = [
  // —— 公司官方一手（爆炸检测重点）——
  { id: "openai", name: "OpenAI", kind: "company", priority: 1, host: "官方", type: "rss", url: "https://openai.com/news/rss.xml" },
  { id: "deepseek", name: "DeepSeek", kind: "company", priority: 1, host: "官方", type: "html", url: "https://www.deepseek.com/news" },
  { id: "qwen", name: "阿里 Qwen", kind: "company", priority: 1, host: "官方", type: "html", url: "https://qwenlm.github.io/blog/" },
  { id: "zhipu", name: "智谱 GLM", kind: "company", priority: 1, host: "官方", type: "html", url: "https://www.zhipuai.cn/news" },
  { id: "kimi", name: "月之暗面 Kimi", kind: "company", priority: 1, host: "官方", type: "html", url: "https://www.moonshot.cn/" },
  { id: "anthropic", name: "Anthropic", kind: "company", priority: 1, host: "官方", type: "html", url: "https://www.anthropic.com/news" },
  // —— Google 系（DeepMind + AI blog 双源）——
  { id: "deepmind", name: "Google DeepMind", kind: "company", priority: 1, host: "官方", type: "rss", url: "https://deepmind.google/blog/rss.xml" },
  { id: "googai", name: "Google AI", kind: "company", priority: 1, host: "官方", type: "rss", url: "https://blog.google/technology/ai/rss/" },
  // —— 趋势与社区 ——
  { id: "hn", name: "Hacker News", kind: "trend", priority: 2, host: "社区", type: "rss", url: "https://hnrss.org/frontpage" },
  { id: "techcrunch", name: "TechCrunch AI", kind: "media", priority: 2, host: "媒体", type: "rss", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { id: "qbitai", name: "量子位", kind: "media", priority: 2, host: "中文媒体", type: "rss", url: "https://www.qbitai.com/feed" },
  // —— 聚合雷达（已验证可抓）——
  { id: "radar", name: "AI News Radar", kind: "radar", priority: 2, host: "聚合", type: "json", url: "https://learnprompt.github.io/ai-news-radar/data/latest-24h.json" },
  { id: "cfrss", name: "CloudFlare 日报", kind: "radar", priority: 2, host: "聚合", type: "rss", url: "https://justlovemaki.github.io/CloudFlare-AI-Insight-Daily/rss.xml" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 ai-daily-report/1.0";

// ============ 工具 ============
function stripHtml(s = "") {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function clamp(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
async function getText(url, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: "*/*" } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
  } finally { clearTimeout(t); }
}

// ============ 各类解析器 ============
function parseRss(xml, src) {
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[0];
    const title = stripHtml((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1]
      || stripHtml((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "")
      || (b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1]?.trim() || "";
    const pub = (b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim()
      || (b.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]?.trim()
      || (b.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]?.trim() || "";
    const desc = stripHtml((b.match(/<(?:description|summary|content:encoded|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded|content)>/i) || [])[1] || "");
    if (title && title.length > 3) {
      items.push({ source: src.name, source_id: src.id, kind: src.kind, priority: src.priority, host: src.host, title, url: link, published_at: pub, summary: clamp(desc, 300) });
    }
  }
  return items.slice(0, 30);
}

// HTML 源：抓 h2/h3/h4 标题与链接；Anthropic/DeepSeek 等为卡片式
function parseHtml(html, src) {
  const items = [];
  // 1) <h2..h4> 内含 <a> 的标题 + 链接
  const reH = /<(h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = reH.exec(html)) !== null) {
    const block = m[2];
    const a = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = stripHtml(a[2] || "");
    let href = a[1];
    if (href.startsWith("/")) href = new URL(href, src.url).toString();
    else if (href.startsWith("./")) href = new URL(href, src.url).toString();
    else if (!href.startsWith("http")) continue;
    if (title.length > 3 && !/^(news|blog|ai|加载中|load)/i.test(title)) {
      items.push({ source: src.name, source_id: src.id, kind: src.kind, priority: src.priority, host: src.host, title, url: href, published_at: "", summary: "" });
    }
  }
  // 2) 无 <a> 的 h2-h4 纯标题（保底，不放链接）
  if (items.length < 5) {
    const reH2 = /<(h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((m = reH2.exec(html)) !== null) {
      const title = stripHtml(m[2]);
      if (title.length > 5 && !/^[A-Za-z\s·|]{0,12}$/.test(title) && !/^(首页|新闻|博客|更多)/.test(title)) {
        items.push({ source: src.name, source_id: src.id, kind: src.kind, priority: src.priority, host: src.host, title, url: "", published_at: "", summary: "" });
      }
    }
  }
  // 去重 + 限 15 条
  const seen = new Set();
  return items.filter(i => { const k = i.title.slice(0, 30); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 15);
}

function parseRadarJson(j) {
  const items = (j.items || []).map(i => ({
    source: i.site_name + " / " + (i.source || ""),
    source_id: "radar",
    kind: "radar",
    priority: 2,
    host: "聚合",
    title: i.title_zh || i.title || "",
    url: i.url || "",
    published_at: i.published_at || "",
    summary: i.recommend_reason_zh ? ("推荐理由：" + i.recommend_reason_zh) : "",
    ai_score: i.ai_score ?? null,
    ai_label: i.ai_label || "",
    source_tier: i.source_tier_label || "",
  }));
  return items;
}

// ============ 主流程 ============
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const all = [];
  const errors = [];
  const stats = [];
  // 并发 4
  const queue = [...SOURCES];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const src = queue.shift();
      try {
        const r = await getText(src.url);
        if (!r.ok) { errors.push(`${src.name}: HTTP ${r.status}`); stats.push({ id: src.id, ok: false, n: 0 }); continue; }
        let items = [];
        if (src.type === "rss") items = parseRss(r.text, src);
        else if (src.type === "html") items = parseHtml(r.text, src);
        else if (src.type === "json") items = parseRadarJson(JSON.parse(r.text));
        // 统一补 id
        for (const it of items) if (!it.id) it.id = `${src.id}-${(it.title || "").slice(0, 24)}`;
        all.push(...items);
        stats.push({ id: src.id, ok: true, n: items.length });
        if (process.env.LOG) console.log(`  ✓ ${src.name}: ${items.length} 条`);
      } catch (e) {
        errors.push(`${src.name}: ${e.message}`);
        stats.push({ id: src.id, ok: false, n: 0 });
      }
    }
  });
  await Promise.all(workers);

  // 全部去重（标题 40 字内相同视为重复，保留优先级高者）
  const seen = new Map();
  const deduped = [];
  for (const it of all) {
    const key = (it.title || "").replace(/[^\w\u4e00-\u9fa5]/g, "").slice(0, 40);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, it); deduped.push(it); }
    else if (it.priority < prev.priority) { // 官方源优先替换媒体源
      const idx = deduped.indexOf(prev);
      deduped[idx] = it;
      seen.set(key, it);
    }
  }

  // 按优先级排序：官方 > 媒体/雷达 > 社区
  deduped.sort((a, b) => a.priority - b.priority || a.kind.localeCompare(b.kind));

  const out = {
    generated_at: new Date().toISOString(),
    hot_mode: !!process.env.HOT_MODE,
    stats,
    errors,
    total: deduped.length,
    items: deduped,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`写入 ${OUT}: ${deduped.length} 条（统计 ${stats.length} 源，失败 ${errors.length}）`);
  if (errors.length) console.log("失败源:", errors.join("; "));
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
