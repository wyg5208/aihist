# AI 纪年 / AI Chronicle

> **当前版本**：v0.2.0 ｜ **更新日期**：2026-10-25

一个中文的人工智能编年史站点：记录里程碑、模型发布、研究突破与产业事件。条目来自固定公开源（OpenRouter、Hugging Face、arXiv、Hacker News、官方公告与科技媒体 RSS），经指纹去重、跨源合并与置信度计算后，还要通过规则预筛和五家不同厂商的大模型评审（至少三票同意）才入档。完整规则见 [收录标准](docs/AI纪年_收录标准_v1.0.md)。

采集与访问完全解耦：后台定时任务每 6 小时跑一次，管理台可手动触发，浏览页面不会发起任何同步。

## 本地开发

需要 Node 22.12–22.x 与 Python 3.11+。前端是 React + Vite，后端是 FastAPI，数据库默认用 SQLite（一个文件，无需安装数据库服务）。

```sh
# 配置：每个键的取值方式在模板里都有注释
cp .env.example .env                                               # Windows 用 copy
python -c "import secrets;print(secrets.token_urlsafe(48))"        # 填 SESSION_SECRET
cd backend && python -m app.cli hash-password "your passphrase"    # 填 ADMIN_PASSWORD_HASH

# 后端：建表 + 灌入 148 条种子 + 启动
cd backend
python -m alembic upgrade head
python -m app.cli seed
python -m uvicorn app.main:app --port 8000
```

```sh
# 前端：/api 代理到 127.0.0.1:8000
npm ci
npm run dev          # http://127.0.0.1:5173
```

管理台在 `/admin/`，登录凭据来自 `SESSION_SECRET` / `ADMIN_USER` / `ADMIN_PASSWORD_HASH`。`.env` 按源码树定位，与启动时的工作目录无关；进程环境变量优先于它。`DATABASE_URL` 换成 `postgresql+psycopg://...` 即可切回 PostgreSQL，代码层面无需改动。

## 构建与检查

```sh
npm run build                 # tsc + Vite + 种子静态页
npm run check:version         # 产品版本三处一致（package.json / pyproject / 本文件顶部）
npm run check:pages           # 校验 dist/e、sitemap、robots、首页 JSON-LD
npm run check:pages:selftest  # 用篡改副本验证检查器本身会失败
npm run check:coverage        # 基准集覆盖率（先跑离线同步，不写库）
npm run check:coverage:selftest
npm run check:pipeline        # 采集解析、聚类、幂等性
npm run check:editorial       # 规则预筛、三模型票型、失败关闭、历史审计、公开接口
npm run check:function        # deno check functions/index.ts（需 Deno，仅用于对照旧实现）
npm run release:gate          # 发布门禁：串行跑上面全套 + 后端测试，红灯即停

cd backend && python -m pytest -q   # 后端接口、采集管线、租约、迁移与 SQLite PRAGMA
```

`npm run build` 分两步：Vite 产出 `dist/index.html` 与资源，随后 `scripts/build-pages.mjs` 为每个种子生成 `dist/e/<slug>.html`，并写出 `dist/sitemap.xml`、`dist/robots.txt`，向首页注入 `WebSite` + `Organization` JSON-LD。

静态页的绝对地址来自 `site.config.mjs` 的 `SITE_ORIGIN`（默认值即线上域名），构建时可用环境变量覆盖：

```sh
SITE_ORIGIN=https://example.com npm run build
```

引用文本中的访问日期取构建日期，所以 `check:pages` 必须针对同一次构建运行。

## 目录结构

```
src/                     React 前端（时间轴、筛选、详情、同步状态面板）
src/admin/               运营台 SPA（14 页，深色控制台，按角色过滤导航）
admin.html               管理台入口，noindex
backend/                 FastAPI 后端
  app/api/               公开接口与管理接口
  app/db/                SQLAlchemy 模型与仓储（SQLite / PostgreSQL 双方言）
  app/analytics/         UA 分类、访问日志解析、摄取与保留策略（纯函数为主）
  app/ingest/            采集管线、编辑门槛、聚类与种子
  app/data/seed.json     人工校订的 148 条历史种子（构建与灌库的唯一来源）
  alembic/               迁移脚本
  tests/                 后端测试，全部跑在 SQLite 上
deploy/                  部署配置
  windows/               Windows Server：安装、服务、任务计划、Caddyfile
  nginx/ systemd cron    Linux 等价配置
scripts/build-pages.mjs  种子静态页、sitemap、robots、首页结构化数据
scripts/check-pages.mjs  静态页与站点文件全量断言
scripts/check-pages-selftest.mjs  检查器反例自检
scripts/benchmark.mjs    覆盖率基准集（测试夹具，不入库）
scripts/coverage.mjs     匹配、分层统计与阈值判断
scripts/check-coverage.mjs        覆盖率命令，输出本地报告
scripts/check-coverage-selftest.mjs  覆盖率检查器自检
scripts/check-pipeline.mjs        采集管线检查
scripts/check-editorial.mjs       收录门槛检查（含离线三模型夹具）
functions/               旧的 Deno Edge Function，仅作迁移对照，稳定后删除
dev/                     录制上游样本与旧本地夹具，不进入发布目录
site.config.mjs          站点名称、描述、源地址
```

`npm run check:coverage` 会先跑完整的离线同步，再按总量、年代、厂商、类别和高重要度种子统计覆盖率。基准集是人工维护的“应当存在”清单，只用于度量；缺口写入 `coverage-report.json`，该文件仅本地复盘、不进入发布目录。

## 数据与接口

数据库 16 张表（SQLite 与 PostgreSQL 共用一套模型）。档案五张：`events`、`raw_items`、`sync_runs`、`sync_state`、`review_decisions`；运营十一张：`admin_users`、`audit_log`、`page_views`、`crawl_hits`、`log_ingest_state`、`source_health`、`subscribers`、`api_keys`、`api_key_usage`、`partners`、`partner_clicks`。浏览器不接触数据库地址或凭据，所有读写经同源 API：

- `GET  /api/v1/timeline?limit=`
- `GET  /api/v1/events/<slug>`（或 `?id=`）
- `GET  /api/v1/status`
- `GET  /api/v1/standard`
- `POST /api/v1/track`：埋点，无 Cookie、IP 只存哈希，恒返回 204
- `POST /api/v1/subscribe`、`GET /api/v1/subscribe/confirm?token=`、`GET /api/v1/unsubscribe?token=`
- `GET  /api/v1/open/events`、`GET /api/v1/open/events/<slug>`：`X-API-Key`，`OPEN_API_ENABLED=false` 时 404
- `GET  /go/<code>`：合作方跳转与点击计数，302
- `POST /api/v1/admin/sync` 及其余 `/api/v1/admin/*`：需管理台会话与对应权限

公开的 `/timeline`、`/status`、`/events` 字段集由 `test_api_contract.py` 严格断言，新字段一律只进 `/api/v1/admin/*`。

站点地址有两种形态，分工不同：

- `/?e=<slug>`：站内深链，展开主时间轴中的条目，包括未生成静态页的自动条目。
- `/e/<slug>.html`：种子条目的静态引用页，含 canonical、OG、JSON-LD 与来源列表，不依赖 Function，适合外部引用与搜索收录。

## 运营台

`/admin/` 是独立 bundle，深色控制台，与前台纸本年鉴风解耦（`src/admin/theme.css` 只在 admin 入口 import）。导航按权限过滤：

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
python -m app.cli ingest-access-log   # 每小时：新增日志行 → crawl_hits（日志未配置时打印 skip 并退出 0）
python -m app.cli prune               # 每周：按保留期清理四张分析表
python -m app.cli create-owner --username you
```

`ingest-access-log --dry-run` 只计数、不写库、不动 offset，用来校验日志格式是否还对得上（nginx 与 Caddy 样例在 `dev/fixtures/access/`）。增量读靠 `log_ingest_state` 的字节偏移，日志变短就当作轮转并从零重读；没有换行符的尾行留给下一轮，避免服务器半写时丢整行。

## 收录门槛与评审配置

自动条目先经确定性规则预筛，排除融资、人事、合作、价格、发布会、访谈、早报、传闻等新闻型内容；规则分达到 35 的候选再交给评审面板。面板按厂商各取一家 —— DeepSeek、通义千问、智谱 GLM、Kimi、MiniMax —— 最多五席。至少 3 票 `include` 且中位分达到 75 才入档；有效票不足、票型分裂、超时或未配置评审模型时一律暂缓，不会退回无评审的新闻流。

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

预设：`deepseek`（deepseek-v4-flash）、`qwen`（qwen3.5-plus）、`glm`（glm-4.7）、`kimi`（kimi-k3）、`minimax`（MiniMax-M3）。厂商换了新模型时用 `_n_MODEL` 覆盖，自建网关用 `_n_BASE` 覆盖（代码会拼接 `/chat/completions`）；五席共用一个网关时仍可用 `EDITORIAL_JUDGE_BASE` / `KEY` / `MODELS=<模型1>,<模型2>,…` 简写。

留空的席位不计入面板，所以暂时没有密钥的厂商可以整段留空，其余至少 3 席照常工作；少于 3 席时面板报告 `models` 并全部暂缓。五家都默认开启思考，而思考 token 计入 `max_tokens`，预设会按各家语法关掉（Kimi 只接受 `temperature: 1`，所以该席不发送这个字段）。超时 `EDITORIAL_JUDGE_TIMEOUT_MS` 限制在 5000–120000 毫秒：实测 24 条候选一轮 4–58 秒，默认 90 秒是防挂死而不是延迟目标。`GET /api/v1/status` 会返回 `panel.configured` 与具体 `reason`。

## 边界

- SQLite 同一时刻只有一个写者。写入口只有定时任务与管理台手动触发，租约（`sync_state.lease_token`，150 秒 TTL）保证二者不会并发；读走 WAL，不受写阻塞。
- 数据库文件必须放在本机固定磁盘，不能放 SMB/NFS 共享：那里的文件锁语义不可靠，会写坏库。
- 备份只能用 `deploy/backup.py`（SQLite 备份 API）或 `VACUUM INTO`，不能直接复制 `.db` 文件——WAL 下普通复制可能得到撕裂快照。
- 档案库不授予 DELETE：错误条目通过更严格的入库门槛、种子校订与后续迁移修正。唯一的删除任务是每周的 `prune`，它只清四张分析表（`page_views`、`crawl_hits`、`api_key_usage`、`audit_log`），白名单写死在 `backend/app/analytics/retention.py`，其他表永不在其列。
- 采集只保留标题、短摘录与外链，不镜像全文，并标注来源。

## 发布

发布产物里的绝对地址全部来自 `site.config.mjs` 的 `SITE_ORIGIN`，发布到哪个域名就用它构建，否则 canonical、`og:url`、sitemap 与 148 个种子页会一起指错。

```sh
node scripts/release-gate.mjs      # G0 版本一致 → 构建 → 静态页 → 管线 → 收录门槛 → 覆盖率 → 后端测试
```

退出码为 0 才可发布；`--skip` 只用于日常自测，对外发布不得跳过。发布过程、回滚与线上验收清单见 `.qoder/agents/version-release.md`，迭代记录与版本号规则见 `.qoder/agents/iteration-doc.md`。

发布产物是 `dist/`，`spa` 为 `false`（`/admin/` 是例外，走 `admin.html`）。完整的服务器步骤见 `deploy/`：Windows Server 用 `deploy\windows\install.ps1` → `install-service.ps1` → `register-tasks.ps1`；Linux 用 `deploy/bootstrap.sh` → `aihist-api.service` → `cron.d/aihist`。

来源归属与第三方许可证见 `PROVENANCE.md` 和 `vendor/`。
