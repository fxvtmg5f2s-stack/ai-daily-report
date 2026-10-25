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
                                                        只认 12h 内 + 有 url/时间 + 近 30 天未报过；
                                                        没有新条目就明确不推，不再回退老公告
```

```
fetch-sources.mjs（24 源，零依赖；时间戳统一北京时间+08:00）
  │  输出 data/raw.json ≈ 250~500 条/次
  │  过滤：HN 非 AI 标题 / 近 2 天已报过的 URL
summarize.mjs（deepseek-flash, reasoning_effort=none）
  │  重要度分档 1-5 + 来源上限（科技媒体单源 ≤3、非 AI ≤2、无时间戳 ≤3）
  │  「三件事」只收 ≥4 分；代码校验媒体单源 ≤1 条，超了自动返工
  │  近 3 天已报标题注入 → 重复丢弃 / 延续标 [持续跟踪]
  │  去重合并 / 时间戳到分钟 / 趋势追踪（注入近 7 天历史判状态）
  │  长度闸门：去掉 URL 后可见字数 >1500 → 退回压缩（保留验证点与其他节）
  │  输出 data/report.md ≈ 1200 可见字 + 末尾一行透明度统计
  │  同步更新内容库 data/library/index.json
state/pushed.json（2026-10-25 起随仓库提交）
  └─ 爆炸去重：近 7 天 pushed + 永久 ever；不再用跨 run 失效的 Actions artifact
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
## 一句话       只写「谁做了什么、什么后果」（≤50 字；禁主线/拐点/白热化/元年等套话）
## 三件事       分档 ≥4，按重要度+影响面排；每条三行：
                **标题**（来源·时间）
                > 发生了什么 ｜ 为什么重要
                > 验证点：之后可观察、可证伪的信号
                （延续事件标 [持续跟踪]，写「前情 ｜ 最新」；合并多源标「·多源」，单源兜底标「（单源）」）
## 其他值得留意  3 条，3 分，一行一条
## 趋势         2-3 条信号 + 状态（🆕/🔥/✅/❌/💤）+ 为什么值得跟踪
---
> 本期：抓取候选 N 条 → 进入评选 M 条 → 收录 K 条（媒体单源 X 条）……
```

**打分规则（2026-10-20 抄 YeeKal/ai-daily 的硬上限）**：5=官方一手首发+行业级影响；4=官方重要更新/权威媒体（路透/彭博/WSJ/NYT/AP/FT）单源重磅/两家交叉；3=科技媒体单源；≤2=非 AI/无时间戳/纯转述。同一档按影响面排序。

已删掉旧版的「今日看点 / 今日必读 / 公司动态 / 快讯速览」四段——它们互相重复（旧版 81% 的看点只是后文的目录），也是「看着累」的主因。

## 信息源（24 个）

| 类型 | 源 |
|---|---|
| 公司官方 | OpenAI、Anthropic、DeepSeek、阿里Qwen、智谱GLM、月之暗面Kimi、Google DeepMind、Google AI、微软AI博客、AWS ML、Apple ML、字节豆包、MiniMax |
| GitHub 发布流（免代理一手） | Meta Llama、NVIDIA(TensorRT-LLM)、OpenAI SDK、HuggingFace(transformers)、Mistral、DeepSeek-V3 的 releases.atom |
| 趋势/社区 | Hacker News 首页（仅 AI 相关标题） |
| 媒体（辅助交叉，配额 20 条） | TechCrunch AI、量子位 |
| 聚合雷达 | AI News Radar、CloudFlare AI 日报 |

**已知源问题**：HTML 源已支持 `<a><h2>` 卡片与日期解析（2026-10-25，DeepSeek/Anthropic 已能拿到链接和日期）；仍有个别官网无日期或改版后解析不到，缺失 `url` 的条目会被直接丢弃，不再生成“无链接老公告”。Google AI 最新一篇已 13 天、DeepMind 5 天、Apple 5.6 天；3 个 GitHub 发布流 480–600 天没更新；AI News Radar 偶发 526。

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
node scripts/selftest.mjs          # 无网络/无 LLM 的去重回归自测
```

任务计划当天已推送过会跳过；要强制重跑：`pwsh -File _scripts\run-daily-local.ps1 -Force`。

**注意（2026-10-21）**：本机 User 变量与 GitHub Secrets **可能不是同一把 key**。云端报 `402 Insufficient Balance` 时先查**云端那把**的余额——本地余额正常不代表云端正常（实例：本地 ¥19.95 可用，secret 那把余额 0）。

## 变更记录

- 2026-08-23：13 源 0 失败；`deepseek-v4-flash` 为推理模型，必须 `reasoning_effort: "low"`。
- 2026-09-04：Bark 双通道上线；微信 pushid SUCCESS，Bark 拆 6 条送达。
- 2026-09-05：24 源 + GitHub 发布流 + 时间戳到分钟 + 趋势追踪 + 内容库 + 鲸鱼通知摘要。
- 2026-10-20：**60 秒版**——模板重写（一句话/三件事/其他/趋势，重要度 1-5 打分，可见 900 字）；Bark 5-7 条并成 1 条；HN 非 AI 噪音过滤；近 2 天 URL 去重；**修趋势历史正则**（旧正则遇到「趋势是最后一节且文件末尾无换行」永不匹配，导致状态长期全是 🆕）；**云端心跳去重**（本机成功后 commit+push 当天存档，云端 9:00 见存档即跳过）；任务计划加 WakeToRun、关电池限制、当天已推跳过；推送失败不再落档（改用 `.pushed-<日期>` 标记，失败可补推）。
- 2026-10-20 晚（参考 GitHub 同类项目）：**分档 + 来源上限**（5=官方首发+行业级影响；4=官方/权威媒体单源/两家交叉；3=科技媒体单源；非 AI≤2、无时间戳≤3；「某 API 支持某格式」最高 4）；**代码校验「三件事」媒体单源 ≤1，超了自动返工**；**近 3 天标题注入 → 重复丢弃、延续标 [持续跟踪]**（前情/最新）；每条加**验证点**（next signal）；导语**禁套话词表**；**多源/单源标记**；末尾**透明度统计**（候选→评选→收录→媒体单源，代码算不靠模型）；长度闸门改为可见 >1500 才压缩且必须保留验证点与其他节。
- 2026-10-21：云端 hot-flash 连续 `402 Insufficient Balance`——查明 **GitHub Secret 与本地 User key 是两把**（本地 ¥19.95 可用，secret 那把余额 0）；已用 PyNaCl sealed-box 调 `PUT /actions/secrets/DEEPSEEK_API_KEY` 轮换为可用 key。本机 8:05 漏跑（PC 11:19 才开机，`StartWhenAvailable` 未补）→ 任务加 **AtLogOn 触发器** + ps1 **8:00 时间闸门**；当天日报已手动补跑推送（微信 pushid 62943453）。
- 2026-10-25：**修“爆炸级老闻复播”三层根因**——①抓源 HTML 解析支持 `<a><h2>` 卡片 + `<time>`/中文日期（DeepSeek V4.1 Flash 终于拿到 2026-09-10 与真实链接；Anthropic 同类结构一并修），无链接标题直接丢弃；②hot 只认 12h 内、有 `url`+`published_at`、近 30 天库内未报过的条目，**删掉 `fresh<5 → items.slice(0,15)` 回退**；③去重状态从 Actions artifact 改为随仓库提交的 `state/pushed.json`（旧 `download-artifact@v4` 未带 `run-id`，日志实测 `Artifact not found`，每次都是空状态），并加 7 天 pushed + 永久 ever 两层；新增 `selftest.mjs` 7 项回归。本机心跳 push 加 `pull --rebase` + 3 次重试 + 日志 + 失败 Bark 告警，补推 10-23~25 三个心跳提交。**心跳失败根因**：本机 DNS 把 `github.com` 解析到 20.205.243.166（443 实测不通），备用 140.82.112.3 / 140.82.113.3 可通；ps1 三次尝试依次走默认 / 112.3 / 113.3。
