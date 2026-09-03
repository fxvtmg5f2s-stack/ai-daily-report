#!/usr/bin/env node
// push.mjs — 双通道推送：Server酱微信 + Bark 手机（2026-09-04 加 Bark 通道）
// 密钥：SERVERCHAN_SENDKEY（微信，必填）/ BARK_DEVICE_KEY（手机，可选——缺则静默跳过）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const KEY = process.env.SERVERCHAN_SENDKEY;
if (!KEY) { console.error("缺少 SERVERCHAN_SENDKEY 环境变量"); process.exit(1); }

const BARK_KEY = process.env.BARK_DEVICE_KEY || "";
const mode = process.argv[2] || "daily";
const api = `https://sctapi.ftqq.com/${KEY}.send`;

async function send(title, desp) {
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
async function barkSend(title, body, group, extra = {}) {
  if (!BARK_KEY) { console.log("无 BARK_DEVICE_KEY，跳过 Bark 推送"); return; }
  try {
    const r = await fetch("https://api.day.app/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_key: BARK_KEY, title, body, group, ...extra }),
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

async function daily() {
  const report = fs.readFileSync(path.join(DATA_DIR, "report.md"), "utf8");
  const date = new Date().toISOString().slice(0, 10);
  const title = `📰 AI 日报 ${date}`;
  // 微信推送用 markdown；标题取报告第一行（上限放宽到 6000 字符，支持加长版日报）
  const short = report.replace(/#+ /g, "").slice(0, 6000);
  const ok = await send(title, short);
  console.log("日报已推送微信:", JSON.stringify(ok).slice(0, 200));

  // Bark：按节拆条（≤1000 字/条），归档进「AI日报」组
  if (BARK_KEY) {
    const chunks = chunkMarkdown(report, 1000);
    if (chunks.length === 0) chunks.push({ title: "", body: report.replace(/#+ /g, "").slice(0, 1000) });
    for (const c of chunks) {
      await barkSend(`📰 AI 日报 ${date} · ${c.title}`, c.body, "AI日报");
    }
    console.log(`Bark 日报已推 ${chunks.length} 条`);
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

  // Bark：单条直达，归档进「AI爆炸」组（普通提醒级别，2026-09-04 创作者拍板）
  if (BARK_KEY) {
    await barkSend(`⚠️ 爆炸级：${(main.title || "").slice(0, 28)}…`, lines, "AI爆炸");
    console.log("Bark 爆炸推送已发");
  }
}

(mode === "hot" ? hot() : daily()).catch(e => { console.error("FATAL", e.message); process.exit(1); });
