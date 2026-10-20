#!/usr/bin/env node
// summarize.mjs — DeepSeek 汇总：去重合并 → 过滤 → 小白科普 → 输出 Markdown 日报
// 密钥：DEEPSEEK_API_KEY（环境变量，绝不入库）
// 坑（2026-08-23 实测）：deepseek-flash（V4.1 Flash；2026-09-18 由已退役的 deepseek-v4-flash 迁入）为推理模型，reasoning 吃 token，
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
const MODEL = process.env.DAILY_MODEL || "deepseek-flash";
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

const dailyPrompt = (items, trendHistory) => `你是AI资讯主编。读者每天只有60秒，只想弄清"今天有没有值得我管的事"。下面 ${items.length} 条候选资讯JSON（title/source/host/time/summary/url）。

先在心里给每条打「重要度」1-5 分：
5=改变行业能力/价格/规则，且有一手来源可验证（头部公司发新模型、重大政策、行业级突破）
4=头部公司重要发布或重大事件，或≥2家不同来源同报一件事
3=值得知道，但不改变判断
2=边缘、软文、猜测、纯标题
1=与AI无关或旧闻，直接丢

然后输出 Markdown，总长硬性 ≤1000 字（超了会被退回重写）：
# 📰 AI 日报 — ${bjToday()}

## 一句话
（≤50字，给出今天的主线判断；不要罗列条目，不要写"今天有以下"）

## 三件事

**1. [标题](url)**（来源·MM-DD HH:mm）
> 发生了什么：≤45字 ｜ 为什么重要：≤35字，说人话

（共3条，按重要度从高到低；只有重要度≥4才能进；够格不足3条就给2条，不许凑数）

## 其他值得留意

- **[标题](url)**（来源·MM-DD HH:mm）——≤25字说明
（3条，重要度=3；没有就整节省略）

## 趋势

- **信号名**【🆕新出现/🔥发酵中/✅已证实/❌已证伪/💤沉寂】依据一句话
  「为什么值得跟踪」一句话
（2-3条；对照下面的往期记录，上期出现过的必须给状态，新信号标🆕）

铁律：①同一事件只出现一次，"一句话"和正文不得重复；②每条必须带来源与北京时间（从 time 字段复制；未知的条目不进"三件事"）；③不编造背景；④媒体单源爆料不得当主条，除非官方确认或两家以上交叉；⑤不写"科普"小节，把术语直接换成日常说法；⑥宁少勿凑。

${trendHistory}

【数据（host=官方/GitHub发布为一手源，媒体为辅助；time=未知表示无时间戳）】
${JSON.stringify(items)}`;

const hotPrompt = (items) => `你是AI资讯「爆炸级」检测器。下面是过去12小时 ${items.length} 条新资讯JSON（字段：title/source/url/summary/time）。
判定爆炸级标准：头部公司（OpenAI/Anthropic/Google/DeepSeek/阿里Qwen/智谱/月之暗面/xAI/微软/Meta/Nvidia/Mistral/AWS/Apple/字节豆包/MiniMax/零一万物）发布新模型或重大战略/政策；行业级突破；≥2不同来源同报一件重磅事。
【输出】严格JSON（不要markdown代码块、不要多余文字）：
{"is_explosive":true或false,"reason":"一句话","items":[{"title":"原标题","url":"原url","source":"来源名","time":"YYYY-MM-DD","level":"explosive或attention","why":"一句话说明为什么值得看","tip":"≤40字科普，术语用生活化类比"}]}
规则：is_explosive=true 时，items 第一项必须是爆炸主条目(level="explosive")，随后最多再补4条（同事件相关条目或过去12小时其他值得关注条目，level="attention"）；每条都必须有 tip；source/time 从输入数据复制，无时间戳写"未知"。is_explosive=false 时 items 输出空数组 []。
【数据】
${JSON.stringify(items)}`;

async function callLLM(prompt, maxTokens, opts = {}) {
  // 2026-09-18 加：正文长度闸门 + 按次指定 reasoning 档位（防「存根日报被当成功」）
  const minChars = opts.minChars ?? 20;
  const effort = opts.reasoningEffort ?? "low";
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false,
      // 2026-08-23 实测：推理模型 reasoning 会吃满 max_tokens 致 content 空；reasoning_effort:"low" 缓解。
      // 2026-09-18 实测（模型换 deepseek-flash = V4.1 Flash 后）：数据稀疏/自相矛盾时仍会烧穿整个预算
      //   （finish=length、reasoning_tokens=8193、content 空，日报退化成 45 字符存根）；
      //   实测 reasoning_effort:"none" 能真正关掉思考（3.2s、0 reasoning token、正文照出）→ 作降级档。
      reasoning_effort: effort,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`LLM HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const c = j.choices?.[0];
  if (!c || !c.message?.content || c.message.content.length < minChars) {
    throw new Error(`LLM 输出过短/为空 (len=${c?.message?.content?.length ?? 0}, 阈值=${minChars}, finish=${c?.finish_reason}, usage=${JSON.stringify(j.usage)})`);
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
// 2026-10-20 修：旧正则用 (?=\n## |\n$) 收尾，遇「趋势是最后一节且文件末尾无换行」永远匹配不到
//   → 趋势历史长期为空、状态全是🆕。改成按行找节标题，兼容新版「## 趋势」。
function loadTrendHistory(days = 7) {
  const histDir = path.join(DATA_DIR, "history");
  const blocks = [];
  try {
    const files = fs.readdirSync(histDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-days);
    for (const f of files) {
      const md = fs.readFileSync(path.join(histDir, f), "utf8");
      const lines = md.split(/\r?\n/);
      const start = lines.findIndex(l => /^##\s.*趋势/.test(l));
      if (start < 0) continue;
      const buf = [];
      for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        buf.push(lines[i]);
      }
      const body = buf.join("\n").trim();
      if (body) blocks.push(`【${f.replace(".md", "")}】${body.slice(0, 400)}`);
    }
  } catch { /* 无历史则跳过 */ }
  if (!blocks.length) return "";
  return "【往期趋势追踪记录（按日期升序，用于判断本期信号状态）】\n" + blocks.join("\n\n") + "\n";
}

// 2026-10-20 加：HN 首页混进非 AI 条目（Go 证书链/XSLT/JDK/ESP32…），先按标题闸门过滤
const AI_TITLE_RE = /\b(ai|a\.i\.|llm|llms|gpt|chatgpt|claude|gemini|deepseek|openai|anthropic|llama|qwen|mistral|kimi|glm|agent|agents|agentic|chatbot|copilot|diffusion|midjourney|sora|veo|neural|transformer|inference|fine-?tun\w*|machine learning|language model|multimodal|rag|embedding|gpu|nvidia|tpu)\b/i;

// 2026-10-20 加：近 2 天已报过的 URL 不再进候选（防旧闻重播；不含当天，允许重跑当天）
function recentUrls(days = 2) {
  try {
    const lib = JSON.parse(fs.readFileSync(LIB_FILE, "utf8"));
    const today = bjToday();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const seen = new Set();
    for (const d of lib) {
      if (d.date === today || d.date < cutoff) continue;
      for (const it of d.items || []) if (it.url) seen.add(it.url);
    }
    return seen;
  } catch { return new Set(); }
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
      if (!/^\*\*\d+\.|^[-*]|^📌|^🔥|^🔔/.test(t)) continue; // 2026-10-20 兼容新版 **1. [标题](url)**
      const link = t.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
      if (!link) continue;
      const tm = (t.match(/（([^（）]*·[^（）]*)）/) || [])[1] || "";
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

  // 2026-10-20：HN 非 AI 噪音 + 近 2 天已报过的 URL 先剔除，再进预筛
  const recent = recentUrls(2);
  const before = items.length;
  items = items.filter(i => !(i.source_id === "hn" && !AI_TITLE_RE.test(i.title || "")) && !recent.has(i.url));
  console.log(`候选过滤：${before} → ${items.length}（剔除 HN 非AI / 近2天已报 ${before - items.length} 条）`);

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
    // 2026-09-18 实测：V4.1 Flash 在这类大 prompt 上 reasoning 必烧穿预算 ⇒ 首枪直接关思考
    const raw = await withRetry((i) => callLLM(hotPrompt(poolHot), i === 0 ? 8192 : 12000, { reasoningEffort: "none" }));
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
  // 日报：2026-09-18 实测 V4.1 Flash 在真实数据下 reasoning 两次都烧穿（8191 tokens、content 空）
  //   ⇒ 首枪起就关思考（"none"），只把「放大预算」留作降级；正文长度闸门 400 字符防存根。
  let out = await withRetry((i) => callLLM(dailyPrompt(slim(pool), trendHistory), i === 0 ? 8192 : 12000, { minChars: 400, reasoningEffort: "none" }));
  // 2026-10-20 加：60 秒版长度闸门。按「去掉 URL 后可见字数」算（链接本身占几百字符，不该算阅读量）
  const visibleLen = (s) => s.replace(/\((https?:\/\/[^)\s]+)\)/g, "").length;
  if (visibleLen(out) > 1200) {
    console.log(`首版可见 ${visibleLen(out)} 字超长，要求重写压缩…`);
    try {
      const shorter = await callLLM(dailyPrompt(slim(pool), trendHistory) + "\n\n【上一版超长，必须压到1000字以内：只留3条主事件+2条趋势，删掉所有重复表述】", 12000, { minChars: 300, reasoningEffort: "none" });
      if (shorter.length < out.length) { out = shorter; console.log(`压缩版 ${out.length} 字符`); }
    } catch (e) { console.warn("压缩重写失败，保留首版:", e.message); }
  }
  fs.writeFileSync(REPORT, out);
  console.log("已生成日报:", REPORT, `(${out.length} 字符)`);
  updateLibrary(out);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
