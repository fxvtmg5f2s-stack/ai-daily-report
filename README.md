# AI 日报推送系统

每天早上 8:00（北京时间）自动推送 AI 日报到微信，附带每 15 分钟一次的爆炸级事件监测。

## 架构

```
GitHub Actions（云端定时）
  ├─ daily-report.yml   cron 0 0 * * *（=北京 08:00）
  │     fetch-sources → summarize → push
  └─ hot-flash.yml      cron */15 * * * *（每15分钟）
        fetch-sources(HOT) → summarize(HOT) → push hot
```

```
抓源脚本 fetch-sources.mjs（13个源，零依赖）
  │  输出 data/raw.json ≈ 360 条/次
DeepSeek 汇总 summarize.mjs（deepseek-v4-flash, reasoning_effort=low）
  │  去重合并 / 过滤无关 / 💡科普(术语小白化+历史联动) / 客观陈述
  │  输出 data/report.md ≈ 1300字 日报
Server酱 push.mjs
  └─ 推送微信
```

## 信息源（13 个，2026-08-23 实测全部可达）

| 类型 | 源 |
|---|---|
| 公司官方（爆炸重点） | OpenAI、Anthropic、DeepSeek、阿里Qwen、智谱GLM、月之暗面Kimi、Google DeepMind、Google AI |
| 趋势/社区 | Hacker News 首页、TechCrunch AI |
| 中文媒体 | 量子位 |
| 聚合雷达 | [AI News Radar](https://github.com/LearnPrompt/ai-news-radar)（24h 结构化数据，含中文标题/AI评分）、[CloudFlare AI 日报](https://github.com/justlovemaki/CloudFlare-AI-Insight-Daily)（日刊 RSS） |

## 配置（GitHub Secrets，密钥绝不入库）

| Secret | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 模型 API（汇总/判定） |
| `SERVERCHAN_SENDKEY` | Server酱 微信推送 |

可选 `vars.DAILY_MODEL`：默认 `deepseek-v4-flash`（省钱）；可用 `deepseek-v4-pro`（更精）。

## 部署

1. 本仓库所有文件 push 到 GitHub（公开仓库）
2. Settings → Secrets and variables → Actions → 添加以上 2 个 Secrets
3. Actions → Daily AI Report → Run workflow 手动跑一次验证
4. 等 8 点自动推送

## 本地运行（可选）

```powershell
$env:DEEPSEEK_API_KEY='...'; $env:SERVERCHAN_SENDKEY='...'
node scripts/fetch-sources.mjs     # 抓源
node scripts/summarize.mjs         # 汇总（HOT_MODE=1 为爆炸检测）
node scripts/push.mjs daily        # 推日报（hot 为爆炸推送）
```

## 实测记录（2026-08-23）

- 13 源 0 失败，364 条/次
- `deepseek-v4-flash` 为推理模型，默认 reasoning 吃满 max_tokens 导致 content 为空 → **必须 `reasoning_effort: "low"`**（reasoning 8185→336 tokens）
- 日报 1312 字符，微信推送 SUCCESS（pushid 52143152）
- 爆炸检测：非爆炸级不推送（judge 有明确理由）
