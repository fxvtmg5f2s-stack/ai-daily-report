# AI 日报推送系统

每天早上 8:00（北京时间）自动推送 AI 日报到**微信 + 手机 Bark**，附带每 15 分钟一次的爆炸级事件监测。

## 架构

```
本机任务计划（主力，2026-08-29 起）         GitHub Actions（备胎）
  AI日报-本地兜底 08:05                        ├─ daily-report.yml  cron 0 0 * * *（=北京 08:00）
  └─ _scripts\run-daily-local.ps1              └─ hot-flash.yml     cron */15 0-13 * * *
       fetch → summarize → push daily                fetch(HOT) → summarize(HOT) → push hot
```

```
抓源脚本 fetch-sources.mjs（13个源，零依赖）
  │  输出 data/raw.json ≈ 360 条/次
DeepSeek 汇总 summarize.mjs（deepseek-v4-flash, reasoning_effort=low）
  │  去重合并 / 过滤无关 / 💡科普(术语小白化+历史联动) / 客观陈述
  │  输出 data/report.md ≈ 1300~4000字 日报
push.mjs 双通道（2026-09-04 加 Bark）
  ├─ Server酱 → 微信（全文存档，上限 6000 字符）
  └─ Bark → iPhone 锁屏（日报按「## 」节拆条 ≤1000 字/条，归档组「AI日报」；
       爆炸级单条直达，归档组「AI爆炸」。BARK_DEVICE_KEY 缺则静默跳过、失败不阻断）
```

## 信息源（13 个，2026-08-23 实测全部可达）

| 类型 | 源 |
|---|---|
| 公司官方（爆炸重点） | OpenAI、Anthropic、DeepSeek、阿里Qwen、智谱GLM、月之暗面Kimi、Google DeepMind、Google AI |
| 趋势/社区 | Hacker News 首页、TechCrunch AI |
| 中文媒体 | 量子位 |
| 聚合雷达 | [AI News Radar](https://github.com/LearnPrompt/ai-news-radar)（24h 结构化数据，含中文标题/AI评分）、[CloudFlare AI 日报](https://github.com/justlovemaki/CloudFlare-AI-Insight-Daily)（日刊 RSS） |

## 配置（GitHub Secrets + 本机 User 环境变量，密钥绝不入库）

| Secret / 环境变量 | 用途 | 可选 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 模型 API（汇总/判定） | 必填 |
| `SERVERCHAN_SENDKEY` | Server酱 微信推送 | 必填 |
| `BARK_DEVICE_KEY` | Bark iPhone 推送（Bark App 首页的设备 key；与工作台 dsh-notify 共用同一把） | 可选（缺则跳过手机通道） |

可选 `vars.DAILY_MODEL`：默认 `deepseek-v4-flash`（省钱）；可用 `deepseek-v4-pro`（更精）。

## 部署

1. 本仓库所有文件 push 到 GitHub（公开仓库）
2. Settings → Secrets and variables → Actions → 添加以上 Secrets（`BARK_DEVICE_KEY` 可选）
3. 本机任务计划 `AI日报-本地兜底` 读 User 环境变量同名三把密钥
4. Actions → Daily AI Report → Run workflow 手动跑一次验证
5. 等 8 点自动推送（微信 + 手机）

## 本地运行（可选）

```powershell
$env:DEEPSEEK_API_KEY='...'; $env:SERVERCHAN_SENDKEY='...'; $env:BARK_DEVICE_KEY='...'
node scripts/fetch-sources.mjs     # 抓源
node scripts/summarize.mjs         # 汇总（HOT_MODE=1 为爆炸检测）
node scripts/push.mjs daily        # 推日报（hot 为爆炸推送）；BARK_DEVICE_KEY 可缺省
```

## 实测记录

- 2026-08-23：13 源 0 失败，364 条/次；`deepseek-v4-flash` 为推理模型，默认 reasoning 吃满 max_tokens 导致 content 为空 → **必须 `reasoning_effort: "low"`**；日报 1312 字符，微信 SUCCESS（pushid 52143152）；爆炸检测：非爆炸级不推送。
- 2026-09-04：Bark 双通道上线试跑——整链路 EXIT=0，微信 pushid 54302146 SUCCESS，Bark 日报拆 6 条送达；hot 夹具测试微信 54302182 + Bark 送达。
