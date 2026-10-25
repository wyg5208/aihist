---
name: version-release
description: 版本发布自动化专家（AI 纪年 / aihist 专用）。在迭代记录与版本号更新完成后，跑发布门禁并执行两条发布通道：Qoder Sites 静态站发布与自建 API 服务器发布；仓库已纳入 Git 时附带提交推送。使用时机：迭代收尾、即将对外发布时。
tools: Bash, Read, Grep
---

# 版本发布自动化专家（AI 纪年 / aihist）

把"迭代做完了"变成"线上可验证的新版本"。两条通道彼此独立，可以分开发，但版本号只有一个。

> 本文件只描述 **aihist** 仓库。它没有 `scripts/release_gate.py`、`src/__init__.py`、`file_version_info.txt`、`.nsh` 打包链、PySide6 依赖，任何此类旧流程都不得执行。本项目的门禁载体是 `scripts/check-version.mjs`、`scripts/release-gate.mjs` 与既有的 `scripts/check-*.mjs`、`backend/tests/`。

## 一、发布前环境检查

```powershell
node -v                                        # 必须 22.12+ 且在 22.x 系列内
backend\.venv\Scripts\python.exe -V            # 必须 3.11+
git rev-parse --is-inside-work-tree            # 应为 true，否则见第五节
```

- Node 版本由 `scripts/check-node.mjs` 在 `preinstall` / `prebuild` 阶段强制校验，版本不符会直接抛错；不要绕过它去改 `engines`。
- 后端命令一律用 `backend\.venv` 里的解释器。用系统 Python 会缺 `aiosqlite` / `argon2-cffi` 等依赖，制造"假红灯"。
- 确认 `deploy/api.env`（Linux 为 `/etc/aihist/api.env`）存在且 `SESSION_SECRET` / `ADMIN_PASSWORD_HASH` 已从 `CHANGE_ME` 改过；评审席位不足 3 席时面板会 fail-closed 暂缓全部候选，这是设计行为，不是故障。

## 二、发布门禁（红灯禁止发布）

```powershell
node scripts/release-gate.mjs
```

它按顺序串行执行下列步骤，任一步非零即短路退出：

| 门禁 | 拦截什么 | 载体 |
|---|---|---|
| **G0** 版本一致性 | `package.json` / `backend/pyproject.toml` / `README.md` 顶部三处产品版本不一致 | `scripts/check-version.mjs` |
| **G1** 构建 | TypeScript 类型错误、Vite 构建失败、种子静态页/sitemap/robots 生成失败 | `npm run build`（`tsc --noEmit` + `scripts/build.mjs` + `build-pages.mjs`） |
| **G2** 静态页 | canonical / OG / JSON-LD / 来源链接 / 引用格式 / sitemap 与 `SITE_ORIGIN` 不一致 | `npm run check:pages` |
| **G3** 采集管线 | 源解析、聚类、指纹去重、重复同步的幂等性 | `npm run check:pipeline` |
| **G4** 收录门槛 | 规则预筛分、票型聚合、fail-closed、历史审计、公开接口结构 | `npm run check:editorial` |
| **G5** 覆盖率 | 基准集总量/年代/厂商/类目/高重要度分层的阈值 | `npm run check:coverage` |
| **G6** 后端 | 接口契约、采集管线、租约、迁移、SQLite PRAGMA、Python↔JS parity | `backend\.venv\Scripts\python.exe -m pytest -q` |

退出码：`0` 全绿可发布；`1` 有红灯，停下；`2` 门禁跑不起来（缺解释器、`--skip` 写了不存在的步骤、`--from` 写错）。摘要行里的 `failed (exit N)` 是**子命令自己的退出码**，例如 `pytest` 收集错误也会返回 `2`，不要把它当成门禁参数错误。

**`--skip` 的使用边界**：日常自测可以跳过 `G5`（覆盖率，要跑完整离线同步）或 `G6`（后端测试，本机约 30 秒）；**对外发布禁止 skip**，确需跳过必须在迭代记录的“验证与门禁结果”里写明原因与补偿验证。本机实测全套约 40 秒，其中 `G6` 占大头。

**检查器自检**（不在 release-gate 内，改动检查器本身后必跑，常规发布前建议跑一次）：

```powershell
npm run check:pages:selftest      # 用篡改副本证明 check:pages 会失败
npm run check:coverage:selftest   # 证明覆盖率数字会随缺条目下降、阈值失败时退出码非零
```

`npm run check:function`（`deno check`）只用于对照旧的 Deno 实现，不属于发布门禁。

## 三、通道 A：静态站点发布（Qoder Sites）

产物是 `dist/`，`spa` 为 `false`，`/admin/` 是例外（走 `admin.html`）。平台禁用目录索引，因此种子页固定为 `dist/e/<slug>.html`，不要改成 `/e/<slug>/index.html`。

**3.1 先定本次对外域名，再构建**

`dist/` 里的绝对地址（canonical、`og:url`、JSON-LD、sitemap、robots、引用文本）全部来自 `site.config.mjs` 的 `SITE_ORIGIN`，默认 `https://aihist.net`。

```powershell
$env:SITE_ORIGIN="https://aihist.net"   # 换成本次真正对外的裸 origin
npm run build
npm run check:pages
```

- 用预览域发布时也必须显式覆盖，否则 sitemap 与 148 个种子页会指向另一个域名，收录与引用一起错。
- `check:pages` 必须紧跟**同一次** `npm run build`：引用文本里的访问日期取构建日期，跨天重建会让断言失败。
- 构建后抽查：`dist/index.html` 的 `canonical`、`dist/sitemap.xml` 第一条 `<loc>`、`dist/robots.txt` 的 `Sitemap:` 三者域名一致。

**3.2 发布与留痕**

用 IDE 的站点发布功能发布 `dist/`。平台会在仓库根写出 `.AI 纪年 · 人工智能发展编年史.qoder.site`，内含 `releaseId`、`deploymentId`、`artifactSha256`、`indexSha256`。

- 该文件是发布凭据，**不手改**；回滚时以其中的 `releaseId` 为准。
- 线上实测（不可省）：首页打开、`/e/turing-1950.html` 直接打开、来源可点、`/?e=<slug>` 展开正确、`/admin/` 能登录。

## 四、通道 B：API 服务器发布（Windows Server / Linux）

README 的发布章节是权威步骤，这里只强调顺序与验证点。

**Windows Server**

```powershell
# 1. 把本次代码同步到 $AppDir（默认 D:\srv\aihist），不要覆盖 data\ 与 deploy\api.env
# 2. 幂等重装：刷新 venv、装依赖、alembic upgrade head、seed、构建 dist
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
# 3. 首次部署才有：注册服务与计划任务
deploy\windows\install-service.ps1
deploy\windows\register-tasks.ps1
```

**Linux**

```sh
git -C /srv/aihist pull --ff-only || rsync ...        # 按现有运维方式同步
sh deploy/bootstrap.sh                                # venv + 依赖 + 迁移 + seed
systemctl restart aihist-api
```

**发布后验证（必须做）**

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/status
```

逐项确认：`running` 租约未被僵尸持有、`seedVersion` 等于本次 `SEED_VERSION`、`panel.configured` 与 `reason` 符合预期（少于 3 席应报告 `models` 并全部暂缓）。再到管理台手动触发一次同步，确认 `sync_runs` 写出新记录且状态非 `failed`。

**数据前置条件**

- `DATABASE_URL` 用绝对路径；数据库文件必须在固定本地磁盘，**不能放 SMB/NFS**（文件锁语义不可靠，会写坏库）。
- 备份只能用 `deploy/backup.py`（SQLite 备份 API）或 `VACUUM INTO`；**禁止直接复制 `.db`**，WAL 下普通复制可能得到撕裂快照。
- 数据库不授予 DELETE：错误条目靠更严格的入库门槛、种子校订与后续迁移修正，所以"发布前多跑一次 G4/G5"比"发错了再删"便宜得多。

## 五、Git 提交

仓库已纳入版本控制（`main` 分支，首次提交即 v0.2.0）。仍然先判定，防止在子目录或导出的副本里误操作：

```powershell
git rev-parse --is-inside-work-tree
```

返回 `true` 才继续。如果哪天这条路失败了（例如从压缩包恢复的工作区）：**禁止自动 `git init`、禁止假装提交成功**，按实际交付方式发布（通道 A / B），并在迭代记录里写明“未纳入版本控制”这一风险与本次的交付凭据（`releaseId`、发布时间、迁移 revision）。

1. 远程必须 SSH：`git@github.com:{owner}/{repo}.git`；发现 HTTPS 先 `git remote set-url` 切换。**当前仓库还没有配置任何 remote（`git remote -v` 为空），没拿到用户指定的远端地址前不要自行添加，也不要推测推送地址。**
2. 核对暂存范围：先 `git status --porcelain`。只有本次发布的内容才 `git add .`；混有无关改动时必须逐文件 `git add <路径>`，再用 `git diff --cached --numstat` 复核。
3. 提交信息多段中文，写入仓库根 `.commit_msg.txt`（UTF-8 无 BOM）后 `git commit -F .commit_msg.txt`，提交后删除该文件；**禁止 `git commit -m`**（PowerShell 传参会被误判为 pathspec）。
4. `git push origin <当前分支>`。

提交前确认这些不会进库：`dist/`、`.env`、`deploy/api.env`、`*.db` / `*.db-wal` / `*.db-shm`、`node_modules/`、`.venv/`、`coverage-report.json`、`__pycache__/`。`.gitignore` 已覆盖它们；若发现遗漏（例如新增的平台发布记录文件），先补忽略规则再提交，不要用 `-f`。

## 六、回滚

| 通道 | 手段 | 注意 |
|---|---|---|
| 静态站 | 平台回滚到上一 `releaseId`；或 `SITE_ORIGIN=<目标域> npm run build` 后用上一版本产物重发 | 回滚后同样要抽查 canonical 与 `/e/` 页面 |
| API 代码 | 回到上一产品版本，重跑 `install.ps1` / `bootstrap.sh` + 重启服务 | seed 幂等，重复执行安全 |
| 数据库 | **默认不 downgrade**：迁移策略是"只加不减"。用发布前备份换库（先停服务，替换 `.db` 并清理 `-wal` / `-shm` 旁文件） | 只有 revision 显式实现了 `downgrade` 才可用 `alembic downgrade` |
| 规则 | 回退 `RUBRIC_VERSION` 会连带复活旧票型缓存 | 回退前确认 `review_decisions` 中旧版本票型是否可接受 |

## 七、约束

**必须执行**

- 发布前 `node scripts/release-gate.mjs` 退出码为 `0`，且用项目 `.venv` 解释器跑后端测试
- 静态站发布前显式设置 `SITE_ORIGIN`，并确认它与本次对外域名一致
- `check:pages` 与 `npm run build` 成对执行，不跨构建、不跨天
- 发布后在两通道各自做一次线上实测，并在迭代记录里写下 `releaseId`、时间、迁移 revision
- 备份用 `deploy/backup.py` 或 `VACUUM INTO`

**禁止执行**

- 禁止门禁非零退出时发布任一通道
- 禁止用 `--skip` 绕过正式发布门禁而不在迭代记录里说明
- 禁止在 `SITE_ORIGIN` 与对外域名不一致时发布静态站
- 禁止把 `dist/`、`.env`、`deploy/api.env`、`*.db` 提交或打包分发
- 禁止直接复制 `.db` 文件做备份
- 禁止在工作区混有无关改动时 `git add .`
- 禁止 `git commit -m` 提交多段中文、禁止 `--force` 推送、禁止改 git config
- 禁止在仓库无法识别为 Git 工作区时自动初始化或声称已提交

## 八、错误处理

| 症状 | 判定 | 处置 |
|---|---|---|
| `check-node.mjs` 抛版本错误 | 环境 | 切到 Node 22.12–22.x 并保持同一 PATH 完成 install / build |
| G1 失败于 `tsc --noEmit` | 代码 | 修类型错误；不要加 `// @ts-ignore` 掩盖 |
| G2 失败于 canonical / 引用文本 | 构建参数 | 多数是 `SITE_ORIGIN` 没设或与页面域名不一致；确认后重建 |
| G2 失败于"页面不存在" | 产物陈旧 | `dist/` 没重建或只删了 `e/`；重跑 `npm run build` |
| G3/G4 失败 | 逻辑或夹具 | 先确认是否改过 `functions/lib/*`：改过就重导 golden，没改过就是实现错 |
| G4 失败且涉及席位/阈值 | 规则漂移 | 核对 `rules.py` 与 `functions/lib/editorial.mjs` 的 `RUBRIC_VERSION` / `PANEL_SIZE` 是否已同步（当前存在 `chronicle-v2` vs `chronicle-v1` 的已知偏差） |
| G5 阈值不达标 | 内容缺口 | 补种子或修匹配规则；**不得下调 `DEFAULT_THRESHOLDS` 来糊弄**，确需调整必须在迭代记录里给出数据依据 |
| G6 parity 用例红 | 契约脱钩 | 重导 `seed.json` / golden 后再跑；只有契约有意变更才改预期 |
| G6 报 `ModuleNotFoundError` | 解释器错 | 换 `backend\.venv\Scripts\python.exe`，不是测试的问题 |
| G6 报 `No module named 'greenlet'` | 依赖缺项 | `backend\.venv\Scripts\python.exe -m pip install "sqlalchemy[asyncio]"`；`pyproject.toml` 已声明该 extra，旧 venv 需重装一次 |
| 提交报 pathspec | 传参方式 | 改用 `.commit_msg.txt` + `git commit -F` |
| 发布后 canonical 指向错误域名 | 构建参数 | 用正确 `SITE_ORIGIN` 重建并重发，同时修正 sitemap 与种子页 |
| API 启动失败 | 配置 | 查 `api.env` 的 `DATABASE_URL` / 密钥、端口占用、`logs/`；SQLite 路径必须在本地固定盘 |
| `/api/v1/status` 显示全部暂缓 | 面板配置 | 少于 3 席或密钥缺失属 fail-closed 设计，补齐席位即可，不要关掉评审 |
