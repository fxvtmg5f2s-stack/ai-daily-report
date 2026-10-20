# AI 日报推送系统（60 秒版）

每天早上 8:05（北京时间）本机出**一条 60 秒日报**：微信全文 + Bark 单条通知（点开看门户全文与近 30 天存档）。
GitHub Actions 9:00 那班只在「本机没出」时补推，不再一天两份。

## 架构

```
本机任务计划（主力，2026-08-29 起）              GitHub Actions（备胎，2026-10-20 改心跳）
  AI日报-本地兜底 08:05                            ├─ daily-report.yml  UTC 1:00 = 北京 09:00
  └─ _scripts\run-daily-local.ps1                  │    先查 data/history/<今日>.md
       fetch → summarize → push daily              │    有 → 跳过（本机已推）
       → 落档 → git 心跳 → Web Push                │    无 → fetch → summarize → push daily
                                                   └─ hot-flash.yml  */15（实际 2-5 次/天）
```

```
fetch-sources.mjs（24 源，零依赖；时间戳统一北京时间+08:00）
  │  输出 data/raw.json ≈ 250~500 条/次
  │  过滤：HN 非 AI 标题 / 近 2 天已报过的 URL
summarize.mjs（deepseek-flash, reasoning_effort=none）
  │  重要度 1-5 打分 → 只把 ≥4 放进「三件事」
  │  去重合并 / 时间戳到分钟 / 趋势追踪（注入近 7 天历史判状态）
  │  长度闸门：去掉 URL 后可见字数 >1200 → 退回重写
  │  输出 data/report.md ≈ 900 可见字（旧版 4300 字）
  │  同步更新内容库 data/library/index.json
push.mjs 双通道
  ├─ Server酱 → 微信（全文 + 门户链接）
  └─ Bark → iPhone，**只发 1 条**（一句话 + 3 条标题，点击直达 /lan-gate/report）
       BARK_DEVICE_KEY（主）/ BARK_DEVICE_KEY_DAILY（小钥匙，只日报）
蓝色大肥鱼（PWA 鲸鱼通知）
  └─ run-daily-local.ps1 推「一句话 + 三件事标题」，点击直达 /lan-gate/report
```

## 日报模板（2026-10-20 起）

```
# 📰 AI 日报 — YYYY-MM-DD
## 一句话       主线判断（≤50 字，不罗列）
## 三件事       重要度 ≥4，按高低排；每条：标题（来源·时间）+「发生了什么｜为什么重要」
## 其他值得留意  3 条，重要度 3，一行一条
## 趋势         2-3 条信号 + 状态（🆕/🔥/✅/❌/💤）+ 为什么值得跟踪
```

已删掉旧版的「今日看点 / 今日必读 / 公司动态 / 快讯速览」四段——它们互相重复（旧版 81% 的看点只是后文的目录），也是「看着累」的主因。

## 信息源（24 个）

| 类型 | 源 |
|---|---|
| 公司官方 | OpenAI、Anthropic、DeepSeek、阿里Qwen、智谱GLM、月之暗面Kimi、Google DeepMind、Google AI、微软AI博客、AWS ML、Apple ML、字节豆包、MiniMax |
| GitHub 发布流（免代理一手） | Meta Llama、NVIDIA(TensorRT-LLM)、OpenAI SDK、HuggingFace(transformers)、Mistral、DeepSeek-V3 的 releases.atom |
| 趋势/社区 | Hacker News 首页（仅 AI 相关标题） |
| 媒体（辅助交叉，配额 20 条） | TechCrunch AI、量子位 |
| 聚合雷达 | AI News Radar、CloudFlare AI 日报 |

**已知源问题（待修）**：6 个官网（Anthropic/DeepSeek/Qwen/智谱/Kimi/微软）抓不到发布时间；Google AI 最新一篇已 13 天、DeepMind 5 天、Apple 5.6 天；3 个 GitHub 发布流 480–600 天没更新；AI News Radar 偶发 526。

## 配置（GitHub Secrets + 本机 User 环境变量，密钥绝不入库）

| Secret / 环境变量 | 用途 | 可选 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 模型 API（汇总/判定） | 必填 |
| `SERVERCHAN_SENDKEY` | Server酱 微信推送 | 必填 |
| `BARK_DEVICE_KEY` | Bark iPhone 推送（主钥匙） | 可选（缺则跳过手机通道） |
| `BARK_DEVICE_KEY_DAILY` | Bark 小钥匙（只收日报，不收爆炸） | 可选 |

可选 `vars.DAILY_MODEL`：默认 `deepseek-flash`（省钱）；可用 `deepseek-v4-pro`（更精）。
可选 `PORTAL_URL`：Bark 点击跳转地址，默认 `http://100.67.66.124:3088/lan-gate/report`。

## 本地运行

```powershell
$env:DEEPSEEK_API_KEY='...'; $env:SERVERCHAN_SENDKEY='...'; $env:BARK_DEVICE_KEY='...'
node scripts/fetch-sources.mjs     # 抓源
node scripts/summarize.mjs         # 汇总（HOT_MODE=1 为爆炸检测）
node scripts/push.mjs daily        # 推日报（hot 为爆炸推送）；PUSH_DRY=1 干跑
```

任务计划当天已推送过会跳过；要强制重跑：`pwsh -File _scripts\run-daily-local.ps1 -Force`。

## 变更记录

- 2026-08-23：13 源 0 失败；`deepseek-v4-flash` 为推理模型，必须 `reasoning_effort: "low"`。
- 2026-09-04：Bark 双通道上线；微信 pushid SUCCESS，Bark 拆 6 条送达。
- 2026-09-05：24 源 + GitHub 发布流 + 时间戳到分钟 + 趋势追踪 + 内容库 + 鲸鱼通知摘要。
- 2026-10-20：**60 秒版**——模板重写（一句话/三件事/其他/趋势，重要度 1-5 打分，可见 900 字）；Bark 5-7 条并成 1 条；HN 非 AI 噪音过滤；近 2 天 URL 去重；**修趋势历史正则**（旧正则遇到「趋势是最后一节且文件末尾无换行」永不匹配，导致状态长期全是 🆕）；**云端心跳去重**（本机成功后 commit+push 当天存档，云端 9:00 见存档即跳过）；任务计划加 WakeToRun、关电池限制、当天已推跳过；推送失败不再落档（改用 `.pushed-<日期>` 标记，失败可补推）。
