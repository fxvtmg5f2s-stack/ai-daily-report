#!/usr/bin/env node
// push.mjs — 双通道推送：Server酱微信 + Bark 手机（2026-09-04 加 Bark 通道）
// 密钥：SERVERCHAN_SENDKEY（微信，必填）/ BARK_DEVICE_KEY（手机，可选——缺则静默跳过）
// 2026-09-05 加：BARK_DEVICE_KEY_DAILY（仅收日报、绝不收爆炸的"小钥匙"；不设=完全同旧行为）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const KEY = process.env.SERVERCHAN_SENDKEY;
if (!KEY) { console.error("缺少 SERVERCHAN_SENDKEY 环境变量"); process.exit(1); }

const BARK_KEY = process.env.BARK_DEVICE_KEY || "";
const BARK_KEY_DAILY = process.env.BARK_DEVICE_KEY_DAILY || "";
const DRY = process.env.PUSH_DRY === "1";
const mode = process.argv[2] || "daily";
const api = `https://sctapi.ftqq.com/${KEY}.send`;

async function send(title, desp) {
  if (DRY) { console.log(`[DRY] 微信推送: ${title}`); return { data: { dry: 1 } }; }
  const r = await fetch(api, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ title, desp }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Server酱失败: ${JSON.stringify(j)}`);
  return j.data;
}

// ===== Bark 通道（可选；失败只告警，不阻断主链路）=====
async function barkSend(title, body, group, extra = {}, deviceKey) {
  const key = deviceKey || BARK_KEY;
  if (!key) { console.log("无 BARK_DEVICE_KEY，跳过 Bark 推送"); return; }
  if (DRY) { console.log(`[DRY] Bark → ${key.slice(0, 6)}*** group=${group} title=${title}`); return; }
  try {
    const r = await fetch("https://api.day.app/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_key: key, title, body, group, ...extra }),
    });
    const j = await r.json();
    if (j.code !== 200) throw new Error(JSON.stringify(j));
  } catch (e) {
    console.warn("Bark 推送失败（不影响主链路）:", e.message);
  }
}

// 按「## 」节拆分 markdown；每节再按段落打包成 ≤max 字的块（APNs 单条 4KB 硬约束）
function chunkMarkdown(md, max) {
  const sections = [];
  for (const raw of md.split(/\r?\n/)) {
    if (raw.startsWith("## ")) {
      sections.push({ name: raw.slice(3).trim(), lines: [] });
    } else if (raw.startsWith("# ")) {
      continue; // 大标题不要，推送标题自带日期
    } else if (sections.length) {
      sections[sections.length - 1].lines.push(raw);
    }
  }
  const out = [];
  for (const s of sections) {
    const text = s.lines.join("\n").trim();
    if (!text) continue;
    const paras = text.length <= max ? [text] : text.split(/\n\n+/).flatMap(p =>
      p.length <= max ? [p] : Array.from({ length: Math.ceil(p.length / max) }, (_, i) => p.slice(i * max, (i + 1) * max))
    );
    let buf = "";
    const packed = [];
    for (const p of paras) {
      if ((buf ? buf.length + 2 : 0) + p.length <= max) buf = buf ? buf + "\n\n" + p : p;
      else { packed.push(buf); buf = p; }
    }
    if (buf) packed.push(buf);
    packed.forEach((c, i) => out.push({ title: `${s.name}${packed.length > 1 ? ` ${i + 1}/${packed.length}` : ""}`, body: c }));
  }
  if (out.length > 10) out.length = 10; // 防刷屏兜底
  return out;
}

// 2026-10-20：日报推送从「按节拆 5-7 条」改成「一条」——一句话 + 三条标题 + 点开看全文
function summaryForPush(md) {
  const lines = md.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const i = lines.findIndex(l => l.startsWith("## 一句话"));
  const one = i >= 0 ? (lines[i + 1] || "") : "";
  const titles = [];
  let inThree = false;
  for (const l of lines) {
    if (l.startsWith("## ")) { inThree = l.includes("三件事"); continue; }
    if (!inThree) continue;
    const m = l.match(/^\*\*\d+\.\s*\[([^\]]+)\]/);
    if (m) titles.push(m[1]);
  }
  return [one, ...titles.map((t, k) => `${k + 1}. ${t}`)].filter(Boolean).join("\n");
}

async function daily() {
  const report = fs.readFileSync(path.join(DATA_DIR, "report.md"), "utf8");
  // 北京时间日期（UTC 日期在凌晨会错一天）
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const portal = process.env.PORTAL_URL || "http://100.67.66.124:3088/lan-gate/report";
  // 微信：60 秒版全文（已缩短）+ 门户链接
  const short = report.replace(/#+ /g, "").slice(0, 6000);
  const ok = await send(`📰 AI 日报 ${date} · 60 秒版`, `${short}\n\n---\n[打开门户看历史与全文](${portal})`);
  console.log("日报已推送微信:", JSON.stringify(ok).slice(0, 200));

  // Bark：只发一条（一句话 + 三条标题），点通知直接打开门户全文
  // 主 key（全量）+ 每日 key（仅日报、不推爆炸），两者互不影响
  const dailyKeys = [BARK_KEY, BARK_KEY_DAILY].filter(Boolean);
  if (dailyKeys.length) {
    const body = summaryForPush(report) || short.slice(0, 800);
    for (const k of dailyKeys) {
      await barkSend(`📰 AI 日报 ${date} · 三件事`, `${body}\n\n点开看全文与近 30 天存档`, "AI日报", { sound: "glass", isArchive: "1", url: portal }, k);
    }
    console.log(`Bark 日报已推 1 条 × ${dailyKeys.length} 个钥匙`);
  }
}

async function hot() {
  const hot = fs.readFileSync(path.join(DATA_DIR, "hot.json"), "utf8");
  let j;
  try { j = JSON.parse(hot); } catch (e) { console.error("hot.json 解析失败，跳过推送:", e.message); return; }
  if (j.is_explosive !== true) { console.log(`非爆炸级（${j.reason || "无理由"}），不推送`); return; }
  const items = (j.items || []).slice(0, 5);
  if (items.length === 0) { console.log("无条目，不推送"); return; }
  // 与日报排版一致：链接内嵌标题 + 来源·日期 + 科普，每条三行
  const lines = items.map(i => {
    const icon = i.level === "explosive" ? "🔥" : "🔔";
    const titleLine = i.url
      ? `**${icon} [${i.title}](${i.url})**`
      : `**${icon} ${i.title}**`;
    const srcTime = [i.source, i.time].filter(Boolean).join("·");
    return `${titleLine}${srcTime ? `（${srcTime}）` : ""}\n> ${i.why || ""}\n💡 科普：${i.tip || "略"}`;
  }).join("\n\n");
  const main = items.find(i => i.level === "explosive") || items[0];
  const ok = await send(`⚠️ 爆炸级：${(main.title || "").slice(0, 28)}…`, lines);
  console.log("爆炸推送成功(微信):", JSON.stringify(ok).slice(0, 200));

  // Bark：单条直达，归档进「AI爆炸」组（普通提醒级别，2026-09-04 创作者拍板；带提示音+存档）
  if (BARK_KEY) {
    await barkSend(`⚠️ 爆炸级：${(main.title || "").slice(0, 28)}…`, lines, "AI爆炸", { sound: "crystal", isArchive: "1" });
    console.log("Bark 爆炸推送已发");
  }
}

(mode === "hot" ? hot() : daily()).catch(e => { console.error("FATAL", e.message); process.exit(1); });
