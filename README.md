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
抓源脚本 fetch-sources.mjs（24个源，零依赖；时间戳统一北京时间+08:00）
  │  输出 data/raw.json ≈ 500+ 条/次
DeepSeek 汇总 summarize.mjs（deepseek-v4-flash, reasoning_effort=low）
  │  去重合并 / 过滤无关 / 💡科普(术语小白化+历史联动) / 客观陈述
  │  时间戳到分钟(MM-DD HH:mm) / 趋势追踪(注入近7天历史，标注信号状态)
  │  输出 data/report.md ≈ 2000~4500字 日报
  │  同步更新内容库 data/library/index.json（逐日累积精选条目）
push.mjs 双通道（2026-09-04 加 Bark）
  ├─ Server酱 → 微信（全文存档，上限 6000 字符）
  └─ Bark → iPhone 锁屏（日报按「## 」节拆条 ≤1000 字/条，归档组「AI日报」；
       爆炸级单条直达，归档组「AI爆炸」。BARK_DEVICE_KEY 缺则静默跳过、失败不阻断）
蓝色大肥鱼（PWA 鲸鱼通知，2026-09-05 升级）
  └─ run-daily-local.ps1 [5/5] 步骤推「今日看点摘要」通知，点击直达 /lan-gate/report
       （日报页底部「📚 内容库」：搜索 + 公司筛选 + 逐日时间线，数据走 /lan-gate/report/library）
```

## 信息源（24 个，2026-09-05 改版；层级：官方一手为主力，媒体仅辅助交叉）

| 类型 | 源 |
|---|---|
| 公司官方（爆炸重点） | OpenAI、Anthropic、DeepSeek、阿里Qwen、智谱GLM、月之暗面Kimi、Google DeepMind、Google AI、微软AI博客、AWS ML、Apple ML、字节豆包、MiniMax |
| GitHub 发布流（社媒/发布动态的免代理一手替代） | Meta Llama、NVIDIA(TensorRT-LLM)、OpenAI SDK、HuggingFace(transformers)、Mistral、DeepSeek-V3 的 releases.atom |
| 趋势/社区 | Hacker News 首页 |
| 媒体（辅助交叉，配额 20 条） | TechCrunch AI、量子位 |
| 聚合雷达 | [AI News Radar](https://github.com/LearnPrompt/ai-news-radar)（24h 结构化数据，含中文标题/AI评分）、[CloudFlare AI 日报](https://github.com/justlovemaki/CloudFlare-AI-Insight-Daily)（日刊 RSS） |

**网络约束（2026-09-05 实测）**：x.ai / ai.meta.com / blogs.nvidia.com / mistral.ai / huggingface.co 等境外官方博客在本机关 Clash 时不可达（DNS 污染+TLS 重置）；X/Bluesky/微博免费抓取均不可行。故境外公司动态走 GitHub 发布流（本机实测可达），上述官方博客留作「开 Clash 时可加」的备选清单。

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
- 2026-09-05：内容设置改版——24 源（+微软/AWS/Apple/豆包/MiniMax + 6 个 GitHub 发布流）；时间戳统一北京时间到分钟；日报模板加「📈 趋势追踪」（注入近 7 天历史，信号标状态）；新增内容库 `data/library/index.json`；鲸鱼通知 body 升级为今日看点摘要。全链路实跑 63s EXIT=0（微信+Bark+鲸鱼三通道）。
