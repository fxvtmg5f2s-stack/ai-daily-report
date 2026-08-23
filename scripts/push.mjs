#!/usr/bin/env node
// push.mjs — Server酱 推送：daily(日报) / hot(爆炸)
// 密钥：SERVERCHAN_SENDKEY（环境变量，绝不入库）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const KEY = process.env.SERVERCHAN_SENDKEY;
if (!KEY) { console.error("缺少 SERVERCHAN_SENDKEY 环境变量"); process.exit(1); }

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

async function daily() {
  const report = fs.readFileSync(path.join(DATA_DIR, "report.md"), "utf8");
  const title = `📰 AI 日报 ${new Date().toISOString().slice(0, 10)}`;
  // 微信推送用 markdown；标题取报告第一行（上限放宽到 6000 字符，支持加长版日报）
  const short = report.replace(/#+ /g, "").slice(0, 6000);
  const ok = await send(title, short);
  console.log("日报已推送:", JSON.stringify(ok).slice(0, 200));
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
  console.log("爆炸推送成功:", JSON.stringify(ok).slice(0, 200));
}

(mode === "hot" ? hot() : daily()).catch(e => { console.error("FATAL", e.message); process.exit(1); });
