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

// 官方公司源 id（与 fetch-sources.mjs 保持一致，用于预筛保底）
const COMPANY_SOURCE_IDS = new Set(["openai", "deepseek", "qwen", "zhipu", "kimi", "anthropic", "deepmind", "googai"]);

const dailyPrompt = (items) => `你是AI资讯编辑，读者是[A]的人工智能小白用户。请对下面 ${items.length} 条中文资讯JSON做：①同一事件多源→合并标注「多源交叉」；②丢弃无关/重复/软文/超过48小时的旧闻；③每条配≤40字「💡科普」（术语用生活类比）；④客观不夸大；⑤禁止编造背景或历史（不确定就不写）。

输出Markdown（严格模板，总长1500~1800字，日期统一 YYYY-MM-DD，每个板块标题与内容之间必须空一行）：
# 📰 AI 今日动态 — ${new Date().toISOString().slice(0, 10)}
## 📝 今日看点
（3-5条客观趋势归纳，每条一行）
## 🏆 今日必读
（3条；至少1条来源不是OpenAI；优先「多源交叉」；格式：
**标题**（来源·YYYY-MM-DD）
> 摘要
💡 科普：…
🔗 [原文](url)
🏷️ 关键词：#词1 #词2）
## 🏢 公司动态
### 公司名
- **标题**：《一句摘要》（科普）
  🔗 [原文](url)
（每家最多4条，无内容的公司不出现）
## ⚡ 快讯速览
（8-10条一句话快讯，每条带🔗链接，无摘要无科普）
## 📈 趋势雷达
（3-4条值得跟踪的信号，每条两行：信号一句话 + 「为什么值得跟踪」一句话）

【数据（title/source/time/summary/url；time=未知表示无时间戳，谨慎使用）】
${JSON.stringify(items)}`;

const hotPrompt = (items) => `你是AI资讯「爆炸级」检测器。下面是过去12小时 ${items.length} 条新资讯JSON（字段：title/source/url/summary）。
判定爆炸级标准：头部公司（OpenAI/Anthropic/Google/DeepSeek/阿里Qwen/智谱/月之暗面/xAI/微软/Meta/Nvidia/Mistral）发布新模型或重大战略/政策；行业级突破；≥2不同来源同报一件重磅事。
【输出】严格JSON（不要markdown代码块、不要多余文字）：
{"is_explosive":true或false,"reason":"一句话","items":[{"title":"原标题","url":"原url","level":"explosive或attention","why":"一句话说明为什么值得看","tip":"≤40字科普，术语用生活化类比"}]}
规则：is_explosive=true 时，items 第一项必须是爆炸主条目(level="explosive")，随后最多再补4条（同事件相关条目或过去12小时其他值得关注条目，level="attention"）；每条都必须有 tip。is_explosive=false 时 items 输出空数组 []。
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
    time: i.published_at ? String(i.published_at).slice(0, 10) : "未知",
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

async function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
  let items = raw.items || [];

  // 预筛：官方公司源全保留 + 其余截止到 N 条
  const official = items.filter(i => COMPANY_SOURCE_IDS.has(i.source_id));
  const others = items.filter(i => !COMPANY_SOURCE_IDS.has(i.source_id));
  const cap = process.env.HOT_MODE ? 40 : 90;
  items = [...official, ...others.slice(0, cap)];

  if (process.env.HOT_MODE) {
    // 爆炸检测
    const cutoff = Date.now() - 12 * 3600 * 1000;
    const fresh = items.filter(it => it.published_at && new Date(it.published_at).getTime() > cutoff);
    const base = fresh.length >= 5 ? fresh : items.slice(0, 15);
    const poolHot = base.slice(0, 80).map(i => ({
      title: (i.title || "").slice(0, 100),
      source: (i.source || "").slice(0, 24),
      url: i.url || "",
      summary: (i.summary || "").slice(0, 60),
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
  console.log(`日报模式：${pool.length} 条（24h内 ${fresh24.length} / 48h内 ${fresh48.length} / 无时间戳 ${undated.length}）送入 DeepSeek(${MODEL}) 汇总…`);
  const out = await withRetry(() => callLLM(dailyPrompt(slim(pool)), 8192));
  fs.writeFileSync(REPORT, out);
  console.log("已生成日报:", REPORT, `(${out.length} 字符)`);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
