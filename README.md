# AI 纪年 / AI Chronicle

> **当前版本**：v0.4.0 ｜ **更新日期**：2026-10-25 ｜ **Node** 22.12–22.x ｜ **Python** 3.11+

一个中文的人工智能编年史站点：记录里程碑、模型发布、研究突破与产业事件。条目来自固定公开源（OpenRouter、Hugging Face、arXiv、Hacker News、官方公告与科技媒体 RSS），经指纹去重、跨源合并与置信度计算后，还要通过规则预筛和五家不同厂商的大模型评审（至少三票同意）才入档。完整规则见 [收录标准](docs/AI纪年_收录标准_v1.0.md)。

采集与访问完全解耦：后台定时任务每 6 小时跑一次，管理台可手动触发，浏览页面不会发起任何同步。未经评审的条目一律暂缓，不会退回"没人看过就发布"的新闻流。

## 站点形态

| 入口 | 说明 |
| --- | --- |
| `/` | 主时间轴：按年代分组、按类别与来源族筛选、展开条目详情、可复制引用 |
| `/?e=<slug>` | 站内深链，展开某条条目，包括尚未生成静态页的自动条目 |
| `/e/<slug>.html` | 种子条目的静态引用页：canonical、OG、JSON-LD、来源列表，**不含 JavaScript**，供外部引用与搜索收录 |
| `/admin/` | 运营台独立 bundle（14 个页面），深/浅双主题，按角色过滤导航，`noindex` |
| `/go/<code>` | 合作方跳转与点击计数，302 |
| `/api/v1/*` | 同源 JSON 接口，浏览器从不接触数据库地址或凭据 |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + Vite 8 + TypeScript，Tailwind CSS 4，shadcn/ui（`components/ui`），无 SSR |
| 后端 | FastAPI + SQLAlchemy 2（async）+ Alembic，Pydantic v2 |
| 数据库 | SQLite（默认，单文件）/ PostgreSQL（改 `DATABASE_URL` 即可） |
| 构建 | `tsc --noEmit` → Vite → `scripts/build.mjs` → `build-pages.mjs`（种子静态页 + sitemap + robots + JSON-LD） |
| 测试 | 后端 `pytest`（244 项，全部跑在 SQLite 上）；前端无单测，用 `scripts/check-*.mjs` 做行为断言 |
| 部署 | 前端：Vercel（根目录 `vercel.json`，回源 `api.aihist.net`）或 Qoder Sites；后端：Windows Server（`deploy/windows/*.ps1` + Caddy）或 Linux（systemd + nginx + cron） |

## 本地开发

### 1. 配置

```sh
cp .env.example .env                                               # Windows 用 copy
python -c "import secrets;print(secrets.token_urlsafe(48))"        # 填 SESSION_SECRET
```

`.env` 按源码树定位，与启动时的工作目录无关；进程环境变量优先于它。

### 2. 后端

```sh
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e .            # Linux: .venv/bin/python
.venv/Scripts/python -m app.cli hash-password "your passphrase"    # 把输出填进 ADMIN_PASSWORD_HASH
.venv/Scripts/python -m alembic upgrade head        # 建表
.venv/Scripts/python -m app.cli seed                # 灌入 148 条种子
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

依赖声明在 `backend/pyproject.toml`，注意 `sqlalchemy[asyncio]` 的 extra 不能省：它带出 `greenlet`，缺了会让 `app.db.repo_sync` 在导入阶段就失败，`pytest` 连收集都过不去。

### 3. 前端

```sh
npm ci
npm run dev          # http://127.0.0.1:5173，/api 代理到 127.0.0.1:8000
```

`preinstall` / `predev` / `prebuild` 都会先跑 `scripts/check-node.mjs` 校验 Node 版本，不符合直接抛错；不要绕过它去改 `engines`。

### 4. 管理台

访问 `/admin/`，凭据来自 `SESSION_SECRET` / `ADMIN_USER` / `ADMIN_PASSWORD_HASH`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run build` | `tsc --noEmit` + Vite + 种子静态页与站点文件 |
| `npm run preview` | 预览构建产物 |
| `npm run check:version` | 产品版本三处一致（G0） |
| `npm run check:pages` | 校验 `dist/e/*.html`、sitemap、robots、首页 JSON-LD |
| `npm run check:pages:selftest` | 用篡改副本验证检查器本身会失败 |
| `npm run check:pipeline` | 采集解析、聚类、幂等性 |
| `npm run check:editorial` | 规则预筛、五席票型聚合、失败关闭、历史审计、公开接口 |
| `npm run check:coverage` | 基准集覆盖率（先跑离线同步，不写库） |
| `npm run check:coverage:selftest` | 覆盖率检查器自检 |
| `npm run check:function` | `deno check functions/index.ts`，需安装 Deno，仅用于对照参考实现 |
| `npm run release:gate` | 发布门禁：串行跑 G0–G6，红灯即停 |
| `cd backend && python -m pytest -q` | 后端接口、采集管线、租约、迁移与 SQLite PRAGMA |

`npm run build` 分两步：Vite 产出 `dist/index.html` 与资源，随后 `scripts/build-pages.mjs` 为每个种子生成 `dist/e/<slug>.html`（当前 148 个），并写出 `dist/sitemap.xml`（149 条 URL）、`dist/robots.txt`，向首页注入 `WebSite` + `Organization` JSON-LD。

静态页的绝对地址来自 `site.config.mjs` 的 `SITE_ORIGIN`（默认 `https://aihist.net`），构建时可覆盖：

```sh
SITE_ORIGIN=https://example.com npm run build     # Windows: $env:SITE_ORIGIN="..."; npm run build
```

引用文本中的访问日期取构建日期，所以 `check:pages` 必须针对**同一次构建**运行。

## 发布门禁

```sh
node scripts/release-gate.mjs            # 或 npm run release:gate
node scripts/release-gate.mjs --list     # 只看步骤
node scripts/release-gate.mjs --skip G6  # 日常自测跳过最慢的一步
node scripts/release-gate.mjs --from G4  # 从某一步开始
```

| 门禁 | 拦截什么 | 载体 | 本机耗时 |
| --- | --- | --- | --- |
| **G0** 版本一致性 | 产品版本三处不一致 | `scripts/check-version.mjs` | 0.1s |
| **G1** 构建 | 类型错误、Vite 失败、静态页生成失败 | `npm run build` | ~12s |
| **G2** 站点文件 | 静态页/sitemap/robots/JSON-LD 缺项或错址 | `scripts/check-pages.mjs` | ~1s |
| **G3** 采集管线 | 解析、聚类、幂等性回归 | `scripts/check-pipeline.mjs` | ~2s |
| **G4** 收录门槛 | 规则预筛、五席聚合、失败关闭、公开接口 | `scripts/check-editorial.mjs` | ~2s |
| **G5** 覆盖率 | 基准集召回不达阈值 | `scripts/check-coverage.mjs` | ~2s |
| **G6** 后端测试 | 接口契约、租约、迁移、SQLite PRAGMA | `pytest` | ~90s |

退出码语义：`0` 全绿、`1` 有检查不通过、`2` 环境跑不起来（例如找不到 `backend/.venv`）。G6 占全套约八成时间，是唯一值得日常跳过的一步；对外发布不得跳过任何一步。摘要行里的 `failed (exit N)` 是子命令的退出码，不是门禁自身的退出码。

## 目录结构

```
src/                     React 前端（时间轴、筛选、详情、同步状态面板）
src/admin/               运营台 SPA：pages/ 14 个页面 + components/ 与 router
admin.html               管理台入口，noindex
backend/                 FastAPI 后端
  app/api/               公开接口（public/open/growth/track/redirect）与管理接口（admin*）
  app/db/                SQLAlchemy 模型与仓储（SQLite / PostgreSQL 双方言）
  app/editorial/         收录规则、标准文本、厂商预设、评审面板与聚合
  app/analytics/         UA 分类、访问日志解析、摄取与保留策略（纯函数为主）
  app/ingest/            采集管线、编辑门槛、聚类与种子
  app/data/seed.json     人工校订的 148 条历史种子（构建与灌库的唯一来源）
  alembic/               迁移脚本
  tests/                 后端测试，全部跑在 SQLite 上
functions/               JS 参考实现：sources / normalize / cluster / editorial / pipeline
                         与 Python 生产实现互为镜像，并负责生成 golden 夹具；不再承接线上请求
dev/                     录制的上游样本、离线评审面板、旧本地夹具，不进入发布目录
scripts/                 构建、检查与门禁脚本（清单见下）
deploy/                  部署配置：windows/（安装、服务、任务计划、Caddy）、nginx/、systemd、cron
docs/                    收录标准、产品规划、借鉴计划、llm_api_guide/（外部资料存档）
docs/开发记录/            迭代记录，命名 v{版本}_{日期}_{主题}.md
.qoder/agents/           迭代记录与版本发布的作业规则（iteration-doc / version-release）
site.config.mjs          站点名称、标题、描述与 SITE_ORIGIN
```

脚本职责：

```
scripts/build.mjs                       Vite 构建后串起静态页生成
scripts/build-pages.mjs                 种子静态页、sitemap、robots、首页结构化数据
scripts/check-version.mjs               G0：产品版本三处 + 规则/数据版本现状
scripts/release-gate.mjs                G0–G6 串行门禁
scripts/check-pages.mjs                 静态页与站点文件全量断言
scripts/check-pages-selftest.mjs        检查器反例自检
scripts/check-pipeline.mjs              采集管线检查
scripts/check-editorial.mjs             收录门槛检查（含离线五席夹具）
scripts/benchmark.mjs                   覆盖率基准集（人工维护的"应当存在"清单）
scripts/coverage.mjs                    匹配、分层统计与阈值判断
scripts/check-coverage.mjs              覆盖率命令，输出 coverage-report.json
scripts/check-coverage-selftest.mjs     覆盖率检查器自检
scripts/check-node.mjs                  Node 版本守卫（preinstall / predev / prebuild）
scripts/export-golden.mjs               从 JS 参考实现重导契约夹具
scripts/export-api-golden.mjs           从参考实现重导接口夹具
scripts/export-seed.mjs                 从 functions/lib/seed.mjs 重导 seed.json
```

`check:coverage` 会先跑完整的离线同步，再按总量、年代、厂商、类别和高重要度种子统计覆盖率。基准集只用于度量；缺口写入 `coverage-report.json`，该文件仅本地复盘、不进入发布目录（已在 `.gitignore`）。

## 数据与接口

数据库 16 张表（SQLite 与 PostgreSQL 共用一套模型）。档案五张：`events`、`raw_items`、`sync_runs`、`sync_state`、`review_decisions`；运营十一张：`admin_users`、`audit_log`、`page_views`、`crawl_hits`、`log_ingest_state`、`source_health`、`subscribers`、`api_keys`、`api_key_usage`、`partners`、`partner_clicks`。

公开接口：

- `GET  /api/v1/timeline?limit=`
- `GET  /api/v1/events/<slug>`（或 `?id=`）
- `GET  /api/v1/status`：`panel.configured`、`reason`、`seedVersion`、rubric 版本与票数
- `GET  /api/v1/standard`：门槛、维度、硬性排除、票数规则的机器可读版本
- `POST /api/v1/track`：埋点，无 Cookie、IP 只存哈希，恒返回 204
- `POST /api/v1/subscribe`、`GET /api/v1/subscribe/confirm?token=`、`GET /api/v1/unsubscribe?token=`
- `GET  /api/v1/open/events`、`GET /api/v1/open/events/<slug>`：需 `X-API-Key`，`OPEN_API_ENABLED=false` 时 404
- `GET  /go/<code>`：合作方跳转与点击计数，302

管理接口（`/api/v1/admin/*`，需会话与对应权限）：登录/登出/会话、改密、审计日志、触发同步（202）、运行列表与详情、暂缓队列、总览、来源健康、评审席位、流量、条目列表与详情、条目处置、订阅者（含 CSV 导出）、API Key 签发与吊销、合作方统计与配置、账号管理、配置体检。

公开的 `/timeline`、`/status`、`/events` 字段集由 `backend/tests/test_api_contract.py` 严格断言，新字段一律只进 `/api/v1/admin/*`。

## 收录门槛与评审面板

自动条目先经确定性规则预筛，排除融资、人事、合作、价格、发布会、访谈、早报、传闻等新闻型内容；规则分达到 35 的候选再交给评审面板，并按分数排序取其上限。面板按厂商各取一家 —— DeepSeek、通义千问、智谱 GLM、Kimi、MiniMax —— 最多五席。至少 3 票 `include` 且中位分达到 75 才入档（`score < 75` 的 `include` 票不计为同意）；有效票不足 3 票、票型分裂（如 2–2）、超时或未配置评审模型时一律暂缓。

评审模型通过环境变量配置：本地写仓库根 `.env`，生产写 `deploy/api.env`（Linux `/etc/aihist/api.env`），密钥只存在于服务器。每席只需要厂商名和密钥，端点、默认模型以及关闭思考的参数由 `backend/app/editorial/providers.py` 的预设提供：

```sh
EDITORIAL_JUDGE_1_PROVIDER=deepseek
EDITORIAL_JUDGE_1_KEY=<secret>
EDITORIAL_JUDGE_2_PROVIDER=qwen
EDITORIAL_JUDGE_2_KEY=<secret>
EDITORIAL_JUDGE_3_PROVIDER=glm
EDITORIAL_JUDGE_3_KEY=<secret>
EDITORIAL_JUDGE_4_PROVIDER=kimi
EDITORIAL_JUDGE_4_KEY=<secret>
EDITORIAL_JUDGE_5_PROVIDER=minimax
EDITORIAL_JUDGE_5_KEY=<secret>
```

预设：`deepseek`（deepseek-v4-flash）、`qwen`（qwen3.5-plus）、`glm`（glm-4.7）、`kimi`（kimi-k3）、`minimax`（MiniMax-M3）。厂商换了新模型时用 `_n_MODEL` 覆盖，自建网关用 `_n_BASE` 覆盖（代码会拼接 `/chat/completions`）；五席共用一个网关时可用 `EDITORIAL_JUDGE_BASE` / `KEY` / `MODELS=<模型1>,<模型2>,…` 简写。

留空的席位不计入面板，暂时没有密钥的厂商可以整段留空，其余至少 3 席照常工作；少于 3 席时面板报告 `models` 并全部暂缓。五家都默认开启思考，而思考 token 计入 `max_tokens`，预设会按各家语法关掉（Kimi 只接受 `temperature: 1`，该席不发送这个字段）。超时 `EDITORIAL_JUDGE_TIMEOUT_MS` 限制在 5000–120000 毫秒：实测 24 条候选一轮 4–58 秒，默认 90 秒是防挂死而不是延迟目标。

`review_decisions` 是票型缓存：已形成多数结论的候选在 rubric 版本不变时直接复用，不再调用模型；`hold` 会在后续同步中再次送审；`RUBRIC_VERSION` 变化后旧票型自动失效。

## 运营台

`/admin/` 是独立 bundle，深/浅双主题（顶栏与登录页右上角切换，选择记在 `localStorage`，首次进入跟随系统），与前台纸本年鉴风解耦（`src/admin/theme.css` 只在 admin 入口 import）。导航按权限过滤：

| 角色 | 权限 | 能做什么 |
| --- | --- | --- |
| `analyst` | `read` | 看全部指标，不改任何东西 |
| `editor` | `read` `sync` `decide` | 触发采集、处置条目 |
| `owner` | 全部 + `manage` | 账号、密钥、合作、订阅、审计、配置体检 |

环境变量里的 `ADMIN_USER` / `ADMIN_PASSWORD_HASH` 永远可登录且视为 `owner`，是改坏 `admin_users` 后的回退通道；日常账号用 `#/users` 或 `python -m app.cli create-owner` 建。所有写操作落 `audit_log`（IP 只存哈希，`detail` 不存密钥），内容处置必须填理由。条目「下架」是 `editorial_status='excluded'`，公开接口立即 404，不是删行。

指标口径写在代码里，不靠人记：

- `PV` = 当日 `page_views` 行数（人类、非 bot）；`UV` = 当日 `count(distinct visitor_hash)`
- `AI 抓取` = 当日 `crawl_hits where is_ai`，按 `bot_name` 分组
- 入档率 = 近 7 日 `admitted / (admitted + excluded + held)`

埋点与访问日志是两套口径，页面上分开呈现、绝不相加：埋点只覆盖 SPA，而 `/e/<slug>.html` 这些引用页没有 JavaScript（`check-pages.mjs` 硬断言），只能从反向代理日志看到——这也正是「被引用」唯一可量化的证据。埋点本身不带 IP、不用 Cookie，`visitor_hash = sha256(vid + salt + day)`，所以跨天无法关联同一个人。

定时任务（Linux `deploy/cron.d/aihist`，Windows `deploy/windows/register-tasks.ps1`）：

```sh
python -m app.cli ingest-access-log   # 每小时：新增日志行 → crawl_hits（未配置日志时打印 skip 并退出 0）
python -m app.cli prune               # 每周：按保留期清理四张分析表
python -m app.cli create-owner --username you
```

`ingest-access-log --dry-run` 只计数、不写库、不动 offset，用来校验日志格式是否还对得上（nginx 与 Caddy 样例在 `dev/fixtures/access/`）。增量读靠 `log_ingest_state` 的字节偏移，日志变短就当作轮转并从零重读；没有换行符的尾行留给下一轮，避免服务器半写时丢整行。

## 版本管理

本仓库有四族版本，互不替代：

| 版本族 | 真源 | 同步点 |
| --- | --- | --- |
| 产品版本 `X.Y.Z` | `package.json` | `backend/pyproject.toml`、本文件顶部「当前版本」行、迭代记录文件名 |
| 收录规则 `RUBRIC_VERSION`（当前 `chronicle-v2`） | `backend/app/editorial/rules.py` | `functions/lib/editorial.mjs`（参考实现）、票型缓存、`/api/v1/standard` |
| 种子数据 `SEED_VERSION`（当前 `2026.10.24.6`） | `functions/lib/seed.mjs` | `backend/app/data/seed.json`（由 `scripts/export-seed.mjs` 生成）、`sync_state.seed_version` |
| 契约夹具 | `backend/tests/fixtures/golden/*.json` | 由 `scripts/export-golden.mjs` / `export-api-golden.mjs` 从参考实现生成 |

`npm run check:version` 硬校验产品版本三处一致（不一致退出码 1）；规则与数据的漂移只报 `WARN`，但必须在迭代记录里说明处理结论。改规则要同时改两套实现并同步 `scripts/check-editorial.mjs` 的断言，否则检查会"假绿"。

每个对外版本都要写一份 `docs/开发记录/v{版本}_{日期}_{主题}.md`，章节结构与必填项见 `.qoder/agents/iteration-doc.md`；发布流程、回滚方式与线上验收清单见 `.qoder/agents/version-release.md`。仓库已纳入 Git（`main` 分支），首个提交即 v0.2.0 基线。

## 边界与约束

- SQLite 同一时刻只有一个写者。写入口只有定时任务与管理台手动触发，租约（`sync_state.lease_token`，150 秒 TTL）保证二者不会并发；读走 WAL，不受写阻塞。
- 数据库文件必须放在本机固定磁盘，不能放 SMB/NFS 共享：那里的文件锁语义不可靠，会写坏库。
- 备份只能用 `deploy/backup.py`（SQLite 备份 API）或 `VACUUM INTO`，不能直接复制 `.db` 文件——WAL 下普通复制可能得到撕裂快照。
- 档案库不授予 DELETE：错误条目通过更严格的入库门槛、种子校订与后续迁移修正。唯一的删除任务是每周的 `prune`，它只清四张分析表（`page_views`、`crawl_hits`、`api_key_usage`、`audit_log`），白名单写死在 `backend/app/analytics/retention.py`，其他表永不在其列。
- 采集只保留标题、短摘录与外链，不镜像全文，并标注来源。

## 发布

发布产物里的绝对地址全部来自 `site.config.mjs` 的 `SITE_ORIGIN`，发布到哪个域名就用它构建，否则 canonical、`og:url`、sitemap 与 148 个种子页会一起指错。**先定域名，再构建，最后校验**——`check:pages` 必须与同一次 `npm run build` 配对，否则校验的是上一次产物。

```sh
node scripts/release-gate.mjs      # G0 版本一致 → 构建 → 静态页 → 管线 → 收录门槛 → 覆盖率 → 后端测试
```

退出码为 0 才可发布；`--skip` 只用于日常自测，对外发布不得跳过。

三条通道彼此独立，可以分开发，但版本号只有一个：

- **静态站**（Qoder Sites）：构建产物 `dist/`，`spa` 为 `false`（`/admin/` 是例外，走 `admin.html`）。发布回执写入根目录 `*.qoder.site`（含 `releaseId` / `deploymentId` / `artifactSha256`），该文件已被 `.gitignore` 忽略；回滚即用回执里的 `releaseId` 退回上一版。
- **静态站**（Vercel）：`vercel.json` 把 nginx 的路由规则复刻到平台侧——`/admin` 与 `/e/<slug>` 的 rewrite、`/api` 与 `/go` 回源 `https://api.aihist.net`、assets 一年 immutable、`/e/` 七天、`/admin` 加 `X-Robots-Tag`。构建命令仍是 `npm run build`，产物 `dist`，`cleanUrls` 必须保持 `false`：canonical 与 sitemap 里的规范地址带 `.html`，开了 `cleanUrls` 会把 159 条 URL（158 个种子页 + 首页）一起 308 掉。
- **API 服务器**：Windows Server 用 `deploy\windows\install.ps1 -ApiHost api.aihist.net` → `install-service.ps1` → `register-tasks.ps1` → `switch-caddy.ps1`；Linux 用 `deploy/bootstrap.sh` → `aihist-api.service` → `cron.d/aihist`。`install.ps1` 默认不构建 `dist\`（前端归 Vercel），仍要整站自托管时加 `-BuildSite`；`-SiteOrigin` 必须等于 api.env 里的 `SITE_ORIGIN`，否则直接中断——订阅确认链接与来源分类都从它拼出来。`switch-caddy.ps1` 把 Caddy 从「全站」换成 `Caddyfile.api`（只留 `/api` 与 `/go`，其余硬 404）：先 `caddy validate`、再备份旧文件、最后重启并探活，回滚命令由它自己打印。发布后用 `GET /api/v1/status` 核对 `seedVersion` 与 `panel.configured`，用 `GET /api/v1/standard` 核对 `rubricVersion` / `panelSize` / `minVotes` / `includeScore`。

前端上 Vercel 时后端不搬家：SQLite 要在本机固定磁盘、采集是 6 小时的定时任务、租约与 track 限流都是进程内状态，这些都不成立在 Serverless 上。所以 `api.aihist.net` 只暴露两个前缀（`deploy/windows/Caddyfile.api`，其余路径硬 404），Vercel 用 rewrite 做服务端回源，浏览器始终只看 `aihist.net`，`src/api.ts` 的 `BASE = "/api/v1"` 与管理台的 host-only Cookie 都不用改。两个必须记住的代价：`/api` 上的 `CDN-Cache-Control: no-store` 不能删，Vercel 会按上游响应缓存 external rewrite，管理台会读到旧数据；`/e/<slug>.html` 的访问记录不再落在本机反代日志里，`ingest-access-log` 的 `crawl_hits` 链路会断（`switch-caddy.ps1` 结尾会比对 `ANALYTICS_LOG_PATH`，指向旧的 `access.log` 时告警）。

已知待办：本地构建的 canonical 是 `https://aihist.net/`，而托管侧回执记录的 canonical 落在 `*.qoder.zone`，两者尚未统一，正式对外发布前需要把 `SITE_ORIGIN` 与实际域名对齐。

来源归属与第三方许可证见 `PROVENANCE.md` 和 `vendor/`。
