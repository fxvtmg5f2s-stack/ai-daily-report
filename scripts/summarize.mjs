#!/usr/bin/env node
// summarize.mjs — DeepSeek 汇总：去重合并 → 过滤 → 小白科普 → 输出 Markdown 日报
// 密钥：DEEPSEEK_API_KEY（环境变量，绝不入库）
// 坑（2026-08-23 实测）：deepseek-v4-flash 为推理模型，reasoning 吃 token，
// 大 prompt 会导致 content 为空 → 必须精简输入 + 重试兜底。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const RAW = path.join(DATA_DIR, "raw.json");
const REPORT = path.join(DATA_DIR, "report.md");
// 爆炸推送去重状态（经 GitHub Actions artifact 跨运行持久化）
const STATE_DIR = path.join(__dirname, "..", "state");
const STATE_FILE = path.join(STATE_DIR, "pushed.json");

function normTitle(t) { return (t || "").replace(/[^\w\u4e00-\u9fa5]/g, "").slice(0, 40); }
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { pushed: [] }; } }

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) { console.error("缺少 DEEPSEEK_API_KEY 环境变量"); process.exit(1); }
const MODEL = process.env.DAILY_MODEL || "deepseek-v4-flash";
const API = "https://api.deepseek.com/chat/completions";

// 官方一手源 id（公司官方 + GitHub 发布流，与 fetch-sources.mjs 保持一致，用于预筛保底）
const COMPANY_SOURCE_IDS = new Set(["openai", "deepseek", "qwen", "zhipu", "kimi", "anthropic", "deepmind", "googai", "msai", "awsml", "appleml", "doubao", "minimax", "rel-meta", "rel-nvidia", "rel-openai", "rel-hf", "rel-mistral", "rel-deepseek"]);

// 北京时间显示（任何环境时区都稳定输出 MM-DD HH:mm）
const BJ_FMT = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function bjTime(s) {
  if (!s) return "未知";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "未知";
  return BJ_FMT.format(d).replace(/\//g, "-"); // "08-21 15:30"
}
const bjToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const dailyPrompt = (items, trendHistory) => `你是AI资讯编辑，读者是[A]的人工智能小白用户。请对下面 ${items.length} 条中文资讯JSON做：①同一事件多源→合并标注「多源交叉」；②丢弃无关/重复/软文/超过48小时的旧闻；③每条配≤40字「💡科普」（术语用生活类比）；④客观不夸大；⑤禁止编造背景或历史（不确定就不写）；⑥**信息源分级**：官方一手（host=官方/GitHub发布）优先当主条目，媒体条目（量子位/TechCrunch 等）只用于交叉验证和补充中文视角，不要把媒体单源爆料当主条；⑦**时间戳纪律**：每条新闻必须带「来源·MM-DD HH:mm」（北京时间，从数据 time 字段复制），无时间戳写「未知」，时间是你判断「读者是否已看过」的关键。

输出Markdown（严格模板，总长1500~2000字，日期统一 YYYY-MM-DD，板块标题与内容之间空一行。所有链接一律内嵌在标题里，格式为 **[标题](url)**，禁止单独输出链接行；无 url 的条目标题不带链接）：
# 📰 AI 今日动态 — ${bjToday()}
## 📝 今日看点
（3-5条客观趋势归纳，每条一行，不要链接）
## 🏆 今日必读
（3条；至少1条来源不是OpenAI；优先「多源交叉」；每条三行：
**📌 [标题](url)**（来源·MM-DD HH:mm）
> 摘要
💡 科普：…）
## 🏢 公司动态
### 公司名
- **[标题](url)**：《一句摘要》（💡科普·MM-DD HH:mm）
（每家最多3条，无内容的公司不出现）
## ⚡ 快讯速览
（8-10条，每条一行：- [标题](url)（MM-DD HH:mm），不要摘要不要科普）
## 📈 趋势追踪
（3-4条值得跟踪的信号，每条两行：
- **信号名**【状态：🆕新出现 / 🔥发酵中 / ✅已证实 / ❌已证伪 / 💤沉寂】（依据一句话）
第二行：「为什么值得跟踪」一句话。
状态对照下面给的「往期趋势追踪记录」判断：上期提过的信号必须给出状态，新信号标🆕）

${trendHistory}

【数据（title/source/host/time/summary/url；host=官方/GitHub发布为一手源，媒体为辅助；time=未知表示无时间戳，谨慎使用）】
${JSON.stringify(items)}`;

const hotPrompt = (items) => `你是AI资讯「爆炸级」检测器。下面是过去12小时 ${items.length} 条新资讯JSON（字段：title/source/url/summary/time）。
判定爆炸级标准：头部公司（OpenAI/Anthropic/Google/DeepSeek/阿里Qwen/智谱/月之暗面/xAI/微软/Meta/Nvidia/Mistral/AWS/Apple/字节豆包/MiniMax/零一万物）发布新模型或重大战略/政策；行业级突破；≥2不同来源同报一件重磅事。
【输出】严格JSON（不要markdown代码块、不要多余文字）：
{"is_explosive":true或false,"reason":"一句话","items":[{"title":"原标题","url":"原url","source":"来源名","time":"YYYY-MM-DD","level":"explosive或attention","why":"一句话说明为什么值得看","tip":"≤40字科普，术语用生活化类比"}]}
规则：is_explosive=true 时，items 第一项必须是爆炸主条目(level="explosive")，随后最多再补4条（同事件相关条目或过去12小时其他值得关注条目，level="attention"）；每条都必须有 tip；source/time 从输入数据复制，无时间戳写"未知"。is_explosive=false 时 items 输出空数组 []。
【数据】
${JSON.stringify(items)}`;

async function callLLM(prompt, maxTokens) {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false,
      // 2026-08-23 实测：deepseek-v4-flash 推理模型默认 reasoning 会吃满 max_tokens
      // 导致 content 为空；reasoning_effort: low 修复（reasoning 8185→336 token）
      reasoning_effort: "low",
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`LLM HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const c = j.choices?.[0];
  if (!c || !c.message?.content || c.message.content.length < 20) {
    throw new Error(`LLM 空输出 (finish=${c?.finish_reason}, usage=${JSON.stringify(j.usage)})`);
  }
  return c.message.content;
}

// 精简字段，控制 prompt 体积（推理模型：输入越小 content 空间越大）
function slim(items) {
  return items.slice(0, 110).map(i => ({
    title: (i.title || "").slice(0, 100),
    source: (i.source || "").slice(0, 24),
    host: i.host || "",
    time: bjTime(i.published_at),
    summary: (i.summary || "").slice(0, 70),
    url: (i.url || "").slice(0, 200),
  }));
}

async function withRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); }
    catch (e) { lastErr = e; console.warn(`  重试 ${i + 1}: ${e.message}`); }
  }
  throw lastErr;
}

// —— 内容库（2026-09-05）：跨日报连续性 + 蓝色大肥鱼检索 ——
const LIB_DIR = path.join(DATA_DIR, "library");
const LIB_FILE = path.join(LIB_DIR, "index.json");

// 读历史日报的「趋势雷达/趋势追踪」节，注入 prompt 实现连载式追踪
function loadTrendHistory(days = 7) {
  const histDir = path.join(DATA_DIR, "history");
  const blocks = [];
  try {
    const files = fs.readdirSync(histDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-days);
    for (const f of files) {
      const md = fs.readFileSync(path.join(histDir, f), "utf8");
      const m = md.match(/## 📈 趋势(?:雷达|追踪)[\s\S]*?(?=\n## |\n$)/);
      if (m) blocks.push(`【${f.replace(".md", "")}】${m[0].replace(/^## 📈 趋势(?:雷达|追踪)/, "").trim().slice(0, 400)}`);
    }
  } catch { /* 无历史则跳过 */ }
  if (!blocks.length) return "";
  return "【往期趋势追踪记录（按日期升序，用于判断本期信号状态）】\n" + blocks.join("\n\n") + "\n";
}

// 从日报提取条目（标题+链接+公司+时间）追加进内容库索引
function updateLibrary(reportMd) {
  try {
    fs.mkdirSync(LIB_DIR, { recursive: true });
    let lib = [];
    try { lib = JSON.parse(fs.readFileSync(LIB_FILE, "utf8")); } catch { lib = []; }
    const today = bjToday();
    const items = [];
    let company = "";
    let section = "";
    for (const line of reportMd.split(/\r?\n/)) {
      const t = line.trim();
      const h2 = t.match(/^## (\S+)/);
      if (h2) { section = h2[1]; continue; }
      const h3 = t.match(/^### (\S+)/);
      if (h3) { company = h3[1]; continue; }
      if (!/^[-*]|^📌|^🔥|^🔔/.test(t)) continue; // 只看条目行
      const link = t.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
      if (!link) continue;
      const tm = (t.match(/（([^（）]*)）\s*$/) || [])[1] || "";
      items.push({
        title: link[1].replace(/^📌\s*/, "").slice(0, 120),
        url: link[2],
        company: section === "🏢 公司动态" ? company : "",
        section,
        time: tm.replace(/^[^·]*·/, ""), // "💡科普·MM-DD HH:mm" → "MM-DD HH:mm"
      });
    }
    if (!items.length) return;
    // 去重（同 url 只保留最早）
    const seen = new Set(lib.flatMap(d => (d.items || []).map(i => i.url)));
    const fresh = items.filter(i => !seen.has(i.url));
    if (!fresh.length) return;
    const existing = lib.find(d => d.date === today);
    if (existing) { const s2 = new Set(existing.items.map(i => i.url)); existing.items.push(...fresh.filter(i => !s2.has(i.url))); }
    else lib.push({ date: today, items: fresh });
    lib.sort((a, b) => b.date.localeCompare(a.date));
    fs.writeFileSync(LIB_FILE, JSON.stringify(lib.slice(0, 120), null, 1));
    console.log(`内容库索引已更新: ${LIB_FILE}（新增 ${fresh.length} 条，库内 ${lib.length} 天）`);
  } catch (e) { console.warn("内容库索引更新失败（不阻断主链路）:", e.message); }
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
  let items = raw.items || [];

  // 预筛：官方一手每源保留最近 5 条（防止一手挤满额度）；媒体限额 20 条（辅助角色）；其余按量截断
  const official = items.filter(i => COMPANY_SOURCE_IDS.has(i.source_id));
  const bySrc = new Map();
  for (const it of official) {
    const arr = bySrc.get(it.source_id) || [];
    arr.push(it); bySrc.set(it.source_id, arr);
  }
  const officialTop = [];
  for (const arr of bySrc.values()) officialTop.push(...arr.slice(0, 5));
  const media = items.filter(i => i.kind === "media" && !COMPANY_SOURCE_IDS.has(i.source_id)).slice(0, 20);
  const others = items.filter(i => !COMPANY_SOURCE_IDS.has(i.source_id) && i.kind !== "media");
  const cap = process.env.HOT_MODE ? 40 : 50;
  items = [...officialTop, ...media, ...others.slice(0, cap)];

  if (process.env.HOT_MODE) {
    // 夜间静默：北京时间 22:00-次日 8:00 不做判定、不推送（双保险，cron 已避开此时段）
    const bjHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
    if (bjHour >= 22 || bjHour < 8) {
      fs.writeFileSync(path.join(DATA_DIR, "hot.json"), JSON.stringify({ is_explosive: false, reason: "夜间静默时段(北京时间22:00-8:00)" }));
      console.log(`夜间静默（北京时间 ${bjHour} 点），跳过爆炸判定`);
      return;
    }
    // 爆炸检测
    const cutoff = Date.now() - 12 * 3600 * 1000;
    const fresh = items.filter(it => it.published_at && new Date(it.published_at).getTime() > cutoff);
    const base = fresh.length >= 5 ? fresh : items.slice(0, 15);
    const poolHot = base.slice(0, 80).map(i => ({
      title: (i.title || "").slice(0, 100),
      source: (i.source || "").slice(0, 24),
      url: i.url || "",
      summary: (i.summary || "").slice(0, 60),
      time: (i.published_at || "").slice(0, 10),
    }));
    console.log(`爆炸检测：${items.length} 条（新条目 ${fresh.length}）送入判定`);
    const raw = await withRetry(() => callLLM(hotPrompt(poolHot), 8192));
    // 去掉可能的 ```json 围栏，容错解析
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let out;
    try { out = JSON.parse(jsonText); } catch (e) { throw new Error(`LLM 返回非 JSON: ${raw.slice(0, 200)}`); }
    // 去重：12 小时内已推送过的标题/URL 不再推
    const state = loadState();
    const now = Date.now();
    const live = state.pushed.filter(p => now - p.ts < 12 * 3600 * 1000);
    const titleKeys = new Set(live.map(p => p.key));
    const urlKeys = new Set(live.map(p => p.url).filter(Boolean));
    out.items = (out.items || []).filter(it => !titleKeys.has(normTitle(it.title)) && !(it.url && urlKeys.has(it.url)));
    if (out.items.length === 0) out.is_explosive = false;
    for (const it of out.items) live.push({ key: normTitle(it.title), url: it.url || "", ts: now });
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ pushed: live.slice(-500) }));
    fs.writeFileSync(path.join(DATA_DIR, "hot.json"), JSON.stringify(out));
    console.log("判定结果:", JSON.stringify(out).slice(0, 400));
    return;
  }

  // 日报模式：优先近 24h，不足放宽到 48h，再不足全量；无时间戳官方条目标注"未知"
  const now = Date.now();
  const dated = items.filter(i => i.published_at && !isNaN(new Date(i.published_at).getTime()));
  const byDateDesc = (a, b) => new Date(b.published_at) - new Date(a.published_at);
  const fresh24 = dated.filter(i => now - new Date(i.published_at).getTime() < 24 * 3600 * 1000).sort(byDateDesc);
  const fresh48 = dated.filter(i => now - new Date(i.published_at).getTime() < 48 * 3600 * 1000).sort(byDateDesc);
  const undated = items.filter(i => !i.published_at);
  let pool = fresh24.length >= 8 ? fresh24 : (fresh48.length >= 8 ? fresh48 : items);
  pool = [...pool, ...undated.slice(0, 10)];
  const trendHistory = loadTrendHistory(7);
  console.log(`日报模式：${pool.length} 条（24h内 ${fresh24.length} / 48h内 ${fresh48.length} / 无时间戳 ${undated.length} / 趋势追踪历史 ${trendHistory ? "有" : "无"}）送入 DeepSeek(${MODEL}) 汇总…`);
  const out = await withRetry(() => callLLM(dailyPrompt(slim(pool), trendHistory), 8192));
  fs.writeFileSync(REPORT, out);
  console.log("已生成日报:", REPORT, `(${out.length} 字符)`);
  updateLibrary(out);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
