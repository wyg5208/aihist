# AI 纪年 · 产品规划借鉴与实施计划

**版本** v1.0　|　**编制日期** 2026-10-24　|　**依据**《AI纪年网站产品规划_v1.0.md》与线上档案现状　|　**状态** A1–A7 已实施，A8 随 A5 发布完成

---

## 0. 结论

值得借鉴的不是那套七状态、三角色、双人复核的组织流程，而是它把「可核验、可追溯、可引用」拆成了可以落到字段和按钮上的机制。当前站点已经做到「可核验」的一半（每条都有来源链接），但「可引用」和「可追溯」基本是空的：没有事件级地址、没有结构化数据、没有引用格式、没有变更记录、没有链接健康检查。

本方案取四件核心能力、两件低成本能力，分三批实施：

1. **P0｜永久地址与引用**：slug、`?e=` 深链、复制引用、种子静态页、JSON-LD、sitemap。
2. **P0｜分层基准集**：把「覆盖率」从季度人工比对变成可重复执行的断言。
3. **P1｜观察区与自动晋级**：新条目先进待观察区，交叉验证或达到门槛后进入主时间轴。
4. **P1｜链接巡检与存档兜底**：死链标「存档/待补」，不隐藏事件。
5. **P1｜字段级修订记录**：合并改动留痕，支撑「可追溯」。
6. **P1｜编辑判断「为什么重要」**：只给高重要度种子人工撰写，明确标注。
7. **P2｜Atom feed**：把周刊的分发意图落成可订阅文件，不碰邮件。

不采用的部分见第 10 节。整套改动对现有 249 条数据只做加法，不删行、不改已有标题与摘要。

---

## 1. 现状核实

以下为 2026-10-24 对源码与线上档案的核对结果，作为差距基线。

| 规划中的承诺 | 当前实现 | 差距 |
| --- | --- | --- |
| 每条事件唯一 URL | 单页时间轴，详情为行内展开；无 `?e=`、无 history 同步、无静态页 | 缺 |
| 可引用 | 无复制引用、无引用格式、无 `og:url` | 缺 |
| 机器可读 | 无 JSON-LD、无 sitemap、无 feed；仅 3 个基础 OG 标签 | 缺 |
| 可核验 | 每条有 1–6 个来源链接；新增「原始论文 / 参考资料」来源类别 | 已有，但无链接健康状态 |
| 可追溯 | 有 `first_seen_at/updated_at`；种子不被自动覆盖；合并静默修改置信度与重要度 | 缺字段级修订记录 |
| 置信度分级 | `verified / likely / single` 按来源族自动计算 | 有，但无「待观察」过渡态 |
| 影响定级 | `importance` 0–100 规则计算，UI 显示为「重要度」 | 无人工判断字段 |
| 覆盖率度量 | `check-pipeline` 只有阈值断言（早期≥28、智谱≥10） | 缺基准集与分层报告 |
| 纠错 | 无入口 | 缺，暂缓 |
| 分发表单 | 无 | 缺 |
| 数据规模 | 249 条，其中 148 条种子；最早 1912 年 | 基线 |
| Schema | v2；四表；匿名读写；无 DELETE | 基线 |

---

## 2. 借鉴原则

1. **只借读者能验证的承诺，和机器能执行的闸门。** 人工发布闸门、双人复核、2FA 后台，在单人每周 8 小时的约束下无法持续，不借。
2. **加法优先。** 新字段全部可空或有默认值；存量 249 条回填后与现状完全一致；不引入破坏性迁移。
3. **可信来自透明，不来自宣称。** 用「待观察」「来源待补」「修订记录」替代「权威」话术。
4. **每项能力都要有验收脚本或可观测数字。** 没有验收标准的能力不进入排期。

---

## 3. 能力设计

### P0-1　永久地址、引用与结构化数据

**借自**：规划 2.1「可定位、可核验、可引用」、3.5「发布即被引用，删除仍留痕」。

**为什么现在做**：这是全篇投入产出比最高的一项。当前一条 1912 年的条目和一个随机 HN 帖子共用同一个首页地址，任何一个外部引用都只能指向时间轴顶部，引用价值几乎为零。

#### 设计

- **slug 规则**
  - 种子：直接使用 `seedId`（已是 `turing-1950`、`chatglm-6b-2023` 这类稳定短横线格式）。
  - 自动条目：`y{year}-{fingerprint 前 8 位}`，例如 `y2026-3f9a1c02`。与标题无关，标题修改不影响地址。
  - slug 一经写入不再变更；不使用标题派生，避免改标题导致外链失效。
- **数据库**：`events` 增加 `slug text`，建部分唯一索引 `WHERE slug IS NOT NULL`。
- **回填**：每次同步开始时空 slug 行按批补齐（每批 20 条，最多 50 条/次），幂等；种子按 `SEED_EVENTS` 的指纹匹配，自动条目按规则生成。唯一冲突时把随机段延长到 12 位重试。
- **接口**：
  - `timeline` 每条返回 `slug`。
  - `event` 同时接受 `id`（UUID，兼容旧链接）与 `slug`；二者都无命中返回 404。
- **前端**：
  - URL 约定 `/?e=<slug>`，读取后展开对应行并滚动到位；展开/收起用 `history.replaceState` 同步，避免污染后退历史。
  - 若 slug 不存在（被合并或尚未同步），显示「未找到该条目」提示与「回到时间轴」按钮，不白屏。
  - 详情底部增加「永久链接」与「复制引用」两个动作。引用格式采用 GB/T 7714 风格的简化版：
    `{标题}[EB/OL]. AI 纪年, {事件日期}. {绝对地址}（访问日期：YYYY-MM-DD）.`
  - 复制成功用 `aria-live="polite"` 播报「已复制」，不弹 toast。
- **静态页（仅种子）**：构建期从 `functions/lib/seed.mjs` 生成 `dist/e/<slug>/index.html`，当前 148 页。
  - 每页含标题、日期、摘要、来源列表、「为什么重要」（如有）、返回完整时间轴的链接；内联极简 CSS，不加载主 bundle。
  - 含绝对 canonical、OG 标签、JSON-LD（`Article` + `citation` + `isPartOf WebSite`）。
  - 生成 `dist/sitemap.xml`（首页 + 148 个种子页）与 `robots.txt`。
  - 站点源地址放在 `site.config.mjs` 的 `SITE_ORIGIN`，允许构建时用环境变量覆盖；不能在构建期确定时省略 canonical，而不是写错。
  - 目录索引若在托管侧不生效，退回 `dist/e/<slug>.html` 并在链接中同步调整；发布后必须实测一种形式。

> **实施修正（2026-10-24）**：Qoder Sites 托管明确禁用目录索引（见 `sites-building/references/static-site.md`），因此 A5 直接产出 `dist/e/<slug>.html`，canonical、sitemap、页面内链与引用统一使用该形式，不再生成 `/e/<slug>/index.html`。
- **首页结构化数据**：`index.html` 增加 `WebSite` + `Organization` JSON-LD，声明中文、名称、首页地址。不伪造 `SearchAction`。
- **可抓取性边界**：`?e=` 是可用视图，但依赖 Function，爬虫和发布预览都不执行 Function；静态页才是可收录、可预览的引用载体。两层地址的分工要在文档和页脚写清楚。

#### 验收

- `npm run build` 后 `dist/e/` 页数等于种子数；`check-pages` 校验每页有 `<title>`、canonical、可解析 JSON-LD、至少一个来源链接、HTML 转义正确。
- 打开 `/?e=turing-1950`，正确展开并滚动到该条；复制引用得到上述格式；未知 slug 有明确提示。
- `GET action=event&slug=turing-1950` 返回完整详情；未知 slug 404；原 `id` 查询不回归。
- 发布后实测一个静态页可直接打开、来源可点、返回时间轴链接可用。

#### 边界与风险

- 自动条目没有静态页，只有 `?e=`；这类条目通常时效性强，不追求搜索收录。
- 静态页与 SPA 存在内容重叠；用 canonical 指向静态页降低重复内容风险，SPA 查询页不做 canonical。
- 种子标题或摘要后续若修订，静态页在下次构建时更新，但已发出去的外链仍指向同一 slug，不会断。

**工作量**：2–2.5 人日（含构建脚本与检查）。

---

### P0-2　分层基准集与覆盖率断言

**借自**：规划 M2「覆盖率 = 已收录 / 基准集」、5.3「覆盖率低于阈值即调整投入」。

**为什么现在做**：智谱条目从 1 条补到 11 条那次已经证明，总量 249 条会掩盖结构性盲区。现有检查只有「早期≥28」「智谱≥10」两个阈值，只能防回归，不能发现「某个年代或某个厂商整体缺失」。

#### 设计

- **基准集**：`scripts/benchmark.mjs` 导出约 90 条「应当存在」的条目，每条含：
  ```js
  {
    id: "alexnet-2012",
    year: 2012,
    tokens: ["alexnet", "imagenet"],
    category: "research",
    vendor: null,
    note: "ILSVRC 2012 夺冠",
  }
  ```
  选取标准：维基年表主干 + 各头部厂商的旗舰节点 + 中文侧公认事件；一条只写可核对的名称特征，不写摘要。
- **匹配**：复用 `titleTokens`，命中条件为共享特征词 ≥2，或 `modelKey` 相同，或标题包含基准条目给出的唯一词组。避免用 `ai/model/发布` 这类通用词。
- **分层报告**：
  - 总覆盖率；
  - 按年代（1910s–2020s）；
  - 按厂商（取条目数前 10）；
  - 按类别；
  - 缺口清单，按基准条目的重要度排序。
- **阈值**（首版，允许按基线调整）：
  - 总体 ≥85%；
  - 期望数 ≥5 的年代 ≥70%；
  - 期望数 ≥5 的厂商 ≥60%；
  - 所有 `importance ≥ 85` 的种子必须出现在基准集里，防止「种子很多但没人核对」。
- **不写入数据库**：基准集是测试夹具，只用于度量，绝不自动插入事件，避免把「应该收录」变成「已经收录」。
- **命令**：`npm run check:coverage`，复用 `check-pipeline` 的假 Supabase 与录制上游，先跑同步再算覆盖；输出可读表格与 `coverage-report.json`（仅供本地审阅，不进发布目录）。

#### 验收

- 首次运行给出真实基线数字与缺口清单；至少能指出 3 个具体缺失条目，而不是只报一个百分比。
- 人为删除一条已知种子后，对应用户维度覆盖率下降且脚本退出码非零。
- 基准集条目与种子条目可双向定位：缺口项能直接变成待补种子任务。

**工作量**：工具 0.5 人日 + 基准集整理 0.5–1 人日。

---

### P1-1　观察区与自动晋级

**借自**：规划 3.1 状态机「candidate → verified → published」，降维成自动执行的 `provisional → active`。

**为什么现在做**：规划明确「不做新闻聚合」，但站点实际采集了 4 个中文媒体源与 HN。现在的新条目无论来源强弱都直接进入主时间轴，1912 年的图灵机和一个单源快讯在视觉上同等重要。需要一个过渡态，而不是人审。

#### 设计

- **状态值**：`active | provisional | retracted`。`retracted` 首版只保留字段，不提供 UI；由 Owner 通过受控迁移/控制台使用。
- **分类规则**（在 `finalize` 之后执行）：
  ```
  种子 → active
  verified（≥2 来源族）→ active
  单一来源且是 primary family 且 importance ≥ 65 → active
  其余 → provisional
  ```
  单源国内媒体即使重要度达标也先进入观察区，等第二个来源或官方页面出现；这与规划的「跨源核验」一致。
- **晋级**：每次同步合并后重算状态；满足上述任一条件即 `active` 并写 `promoted_at`。不需要定时任务。
- **主时间轴**：默认只查 `status='active'`；`total` 也只算 active。
- **观察区**：`GET action=timeline&view=recent` 返回 `status='provisional' AND first_seen_at >= now-14d`，按时间倒序，上限 60 条。超过 14 天仍未晋级的条目自动不再展示，但行保留在库中，可通过 `?e=` 直达。
- **前端**：筛选栏上方增加可折叠「近日入档 · 待观察 N 条」条带，复用 `EventRow` 的展开能力；视觉降一级（无年份分组、无朱红标记），并说明「等待交叉验证，尚未并入主时间轴」。
- **兼容**：v3 迁移默认 `active`，存量 249 条上线后展示不变；新规则从下一次同步开始生效。

#### 验收

- `check-pipeline` 构造一条单源媒体候选，断言 `status='provisional'` 且默认时间轴不含它；再补一个官方来源，断言晋级为 `active` 并写入 `promoted_at`。
- 观察区上限、14 天窗口、`?e=` 直达均在本地验证。
- 线上同步后主时间轴数量不减少（存量全为 active）。

**工作量**：1.5 人日（迁移、分类、查询、条带 UI）。

---

### P1-2　链接巡检与存档兜底

**借自**：规划 M1「来源可点开率」与 3.4「快照失败则标记来源待补」。

**修正**：不采用「100% 硬阈值」和「失效即下架整条事件」。链接会腐烂，事件本身仍然成立；可靠性单位是链接，不是事件。

#### 设计

- **表** `app.link_checks`：以归一化 URL 的 SHA-256 为主键，记录 `status`（`ok|dead|unreachable|unchecked`）、`http_status`、`archive_url`、`attempts`、`checked_at`。
- **巡检频率**：每次同步最多并发检查 6 个链接，单请求 4.5 秒超时，与 16 秒抓取窗口并行启动，不额外拉长总时长；优先检查从未检查过的链接，其次检查 30 天前检查过的。
- **判定**：
  - 2xx/3xx → `ok`；
  - 404/410 → `dead`，立即查询 Wayback availability API（4 秒超时），有快照则写入 `archive_url`；
  - 403/429/超时 → `unreachable`，不判死，下轮重试；连续 3 次失败仍只显示「无法验证」。
- **UI**：详情证据列表每条显示状态；死链显示「原链失效 · 查看存档」或「原链失效 · 来源待补」；不改变置信度，不隐藏事件。侧栏同步面板显示「链接：正常 N / 失效 N / 待验证 N」。
- **站点状态**：`status` 增加链接统计，便于每周巡检。
- **不做**：不主动对全部链接调用 Wayback 保存接口（限流且成本高），只在死链时查可用快照；不做逐条手动「立即检查」按钮，避免扩大匿名写入口。

#### 验收

- 用录制样本中的 200/404/超时三种响应跑检查脚本，状态分类正确；404 命中快照时写入 `archive_url`。
- 单次同步新增上游请求不超过 6 个，预算仍 ≤22 秒；链接阶段失败只写 `links:partial`，不影响同步成功。
- 线上至少能展示一条真实死链的「存档/待补」状态（若无死链，则展示全绿统计与最后检查时间）。

**工作量**：2 人日（表、采样、解析、UI、状态汇总）。

---

### P1-3　字段级修订记录

**借自**：规划 3.5「等级变更生成版本记录」与「公开纠错保留原内容」。

**为什么现在做**：现在合并会静默改写 `importance`、`confidence`、`updated_at`，而页面同时宣称可追溯。种子保护已经存在（`origin='seed'` 不覆盖标题摘要），但没有显式记录。

#### 设计

- `events` 增加 `revisions jsonb NOT NULL DEFAULT '[]'`，最多保留 20 条，超出丢弃最旧。
- 每条格式：
  ```json
  { "at": "2026-10-24T09:12:00.000Z", "field": "confidence", "from": "single", "to": "verified", "reason": "merge" }
  ```
- 记录字段：`event_date`、`title`、`summary`、`importance`、`confidence`、`why`。**不记录**来源数组变化，否则每次同步都产生噪声。
- 实现：新增 `functions/lib/revisions.mjs`，导出纯函数 `diffRevision(row, patch, at, reason)`，在生成 `updatePatch` 时调用；种子内容回填时 reason 写 `seed`，自动合并写 `merge`。
- UI：详情页底部可折叠「修订记录（N）」，显示日期、字段、旧值 → 新值、原因；无记录则不渲染。
- 种子保护写成显式断言：自动合并永远不修改种子行的 `title/summary/event_date/importance`（如果将来需要改，只能走种子内容回填）。

#### 验收

- 纯函数单测覆盖 5 个字段；`check-pipeline` 在第二轮同步后断言种子行标题摘要未变。
- 人为制造一次置信度升级，详情页出现一条修订记录；超过 20 条后最旧记录被淘汰。
- 迁移后存量行 `revisions=[]`，UI 无变化。

**工作量**：1 人日。

---

### P1-4　编辑判断「为什么重要」

**借自**：规划 2.1「一句话为什么重要」与 3.2「历史重要性由人判断，不交给模型」。

**设计**

- `events` 增加 `why text` 与 `why_kind text`（`editorial | null`）。自动条目一律为 null，不用模板冒充判断。
- 首批覆盖 `importance ≥ 80` 的种子（约 35–45 条），每条 40–90 字，写「改变了什么」，不重复摘要。
- 详情页在摘要上方以衬线体短段落呈现，标注「为什么重要 · 编辑判断」。
- 内容写入 `seed.mjs` 的 `why` 字段；存量种子通过一次受控的 `seed content backfill` 更新，只写 `why/why_kind/slug`，不碰标题、摘要、日期。
- 阈值检查：`importance ≥ 80` 的种子必须有 `why`；自动条目不得有 `why_kind='editorial'`。

**边界**：这是主观判断，必须标明来源是人；允许后续修订，修订会进入 P1-3 的记录。AI 可以起草，但必须人工改定并署名，不能标注为自动生成。

**工作量**：代码与回填 0.5 人日 + 内容 4–6 小时。

---

### P2-1　Atom feed

**借自**：规划候选 C 的分发意图。

**修正**：规划 3.5 明确「不直接对外发送消息」，周刊的邮件部分自相矛盾。落地为只读 feed，不收集邮箱。

#### 设计

- `GET action=feed` 返回 Atom 1.0，最近 30 天内新增、且 `status='active'`、`origin != 'seed'` 的条目，最多 40 条。
- 条目链接：种子用静态页，自动条目用 `?e=<slug>`；`updated` 用 `updated_at`，`summary` 用现有中文摘要。
- 缓存 `public, max-age=900`；其余接口维持 `no-store`。
- 页脚增加「Atom」入口。是否再做站内「本周新增」筛选作为可选，不阻塞本批。

**验收**：XML 可解析、条目数上限、无种子条目、每个链接可访问；首页不因 feed 增加首屏请求。

**工作量**：0.5 人日。

---

### P2-2　公开纠错（暂不实施，仅记录设计）

规划把「公开纠错」列为差异点，但它需要写入口、频率限制与人工处理，单人项目在流量未验证前不值得建。首版用页脚「发现错误」邮件链接替代；等 P0/P1 完成、有稳定访问后再评估一张只允许 INSERT 的 `corrections` 表（2KB 限制、每日全局上限、不做自动修改事件）。本方案不排期。

---

## 4. 数据与迁移（v3）

### 4.1 表结构变更

```sql
ALTER TABLE app.events
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS revisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS why text,
  ADD COLUMN IF NOT EXISTS why_kind text;

ALTER TABLE app.events
  ADD CONSTRAINT events_status_check
  CHECK (status IN ('active', 'provisional', 'retracted'));

CREATE UNIQUE INDEX IF NOT EXISTS events_slug_key
  ON app.events (slug) WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_status_idx
  ON app.events (status, sort_date DESC);

CREATE TABLE IF NOT EXISTS app.link_checks (
  fingerprint text PRIMARY KEY,
  url text NOT NULL,
  event_id uuid,
  status text NOT NULL DEFAULT 'unchecked',
  http_status integer,
  archive_url text,
  attempts integer NOT NULL DEFAULT 0,
  checked_at timestamptz
);

CREATE INDEX IF NOT EXISTS link_checks_checked_idx
  ON app.link_checks (checked_at NULLS FIRST);
```

### 4.2 访问策略增量

```json
[
  {"table":"link_checks","principal":"anonymous","actions":["select","insert","update"],"template":"public"}
]
```

仍不授予 DELETE；`events` 原有策略不变。`link_checks` 只由 Function 在同步中写入。

### 4.3 回填顺序

1. 应用迁移，`status` 默认 `active`，存量展示不变。
2. 下次同步开始：空 slug 行按批补齐（种子用 `seedId`，自动用 `y{year}-{hash8}`）。
3. 种子内容回填：仅 `why/why_kind/slug`，按指纹匹配；不触碰标题、摘要、日期、重要度。
4. 首次链接巡检从最新 2 年条目开始，逐步覆盖全量。
5. 回填完成后，`prepare_site` 的 `requiredSchemaVersion` 从 2 升到 3，再发布。

### 4.4 迁移审查要点

- 部分唯一索引允许存量 null，避免回填前阻塞。
- `ADD CONSTRAINT` 前确认无非法 `status` 值（新列默认值保证）。
- 不在迁移 SQL 中写种子或回填逻辑，避免与 Function 双重写入。
- 策略只加不减；执行后重新读取数据库确认列、索引、策略与版本号。

---

## 5. 接口变更

| 接口 | 变更 | 返回/行为 |
| --- | --- | --- |
| `GET action=timeline` | 新增 `slug`、`status`；默认只查 `active`；新增 `view=recent` | `items[]` 含 slug；`total` 为 active 总数；`recentCount` 可选 |
| `GET action=event` | 支持 `slug`，保留 `id`；返回 `revisions`、`why`、`status`、`linkChecks` | 未知 slug 404 |
| `GET action=status` | 增加 `statusCounts`（active/provisional）、`linkHealth`（ok/dead/unreachable/unchecked） | 不返回租约 token |
| `POST action=sync` | 不变；结果 notes 增加 `links:n`、`slug:n` | 链接失败不阻断 |
| `GET action=feed` | 新增 | Atom XML，`cache-control: public, max-age=900` |

所有新参数都要走现有 `asInt`/白名单校验；`view` 只接受 `recent`；未知值 400。错误仍只返回固定代码。

---

## 6. 前端与构建改动

| 文件 | 改动 |
| --- | --- |
| `src/types.ts` | `TimelineItem.slug`、`status`；`EventDetail.revisions/why/linkChecks` |
| `src/api.ts` | `fetchEventBySlug`；timeline `view=recent` |
| `src/App.tsx` | 读取 `?e=`、展开/滚动、`replaceState`、未知 slug 提示；观察区条带 |
| `src/components/EventRow.tsx` | 行容器加 `id`；不改变交互 |
| `src/components/EventDetail.tsx` | 永久链接、复制引用、修订记录、为什么重要、链接状态 |
| `src/components/RecentShelf.tsx` | 新增：待观察条带，复用 EventRow |
| `src/lib/citation.ts` | 新增：格式化引用、绝对地址、访问日期 |
| `src/lib/permalink.ts` | 新增：解析与写入 `?e=` |
| `scripts/build-pages.mjs` | 新增：种子静态页、sitemap、robots |
| `scripts/build.mjs` | 构建后调用页面生成 |
| `scripts/check-pages.mjs` | 新增：静态页完整性检查 |
| `scripts/check-coverage.mjs` | 新增：分层覆盖率 |
| `scripts/benchmark.mjs` | 新增：基准集 |
| `functions/lib/slug.mjs` | 新增：slug 规则与冲突重试 |
| `functions/lib/revisions.mjs` | 新增：字段 diff |
| `functions/lib/links.mjs` | 新增：巡检与 Wayback 查询 |
| `functions/lib/db.mjs` | slug/status/revisions/why 列；按 slug 读；链接表读写；recent 查询 |
| `functions/lib/pipeline.mjs` | 状态分类、slug 回填、修订记录、链接巡检、种子内容回填 |
| `functions/handler.mjs` | slug 查询、view、feed、status 统计 |
| `index.html` | WebSite/Organization JSON-LD、OG url 策略 |
| `site.config.mjs` | 新增：`SITE_ORIGIN`，支持环境变量覆盖 |

视觉延续纸质年鉴：待观察条带用细虚线与浅墨色，不使用新色板；复制成功用文字，不用动画。

---

## 7. 优先级实施计划

### 批次总览

| 批次 | 内容 | 依赖 | 预计 | 发布门槛 |
| --- | --- | --- | --- | --- |
| A（P0） | slug、引用、静态页、JSON-LD、sitemap、基准集 | v3 迁移 | 2.5–3.5 人日 | build + check:pages + check:coverage + check:pipeline |
| B（P1） | 观察区、修订记录、链接巡检、为什么重要 | A 的 slug/迁移 | 5–6 人日 | 上述检查 + 状态与链接用例 |
| C（P2） | Atom feed、页脚入口 | B 的 status | 1–1.5 人日 | XML 解析 + 链接抽查 |

总计约 9–11 人日。每批独立发布，不做一次性大爆炸。

### 任务清单

| ID | 任务 | 产出 | 验收 | 工时 | 前置 |
| --- | --- | --- | --- | --- | --- |
| A1 | v3 迁移与策略 | slug 列、索引、预留字段 | 迁移后四表 + 新列可读；存量 249 条不变 | 0.5d | — |
| A2 | slug 规则与回填 | `slug.mjs`、`db.mjs`、`pipeline.mjs` | 全部行有 slug；冲突重试；重复运行不新增 | 0.5d | A1 |
| A3 | 接口支持 slug | `handler.mjs`、`api.ts`、`types.ts` | `event?slug=` 通过；`id` 不回归 | 0.25d | A2 |
| A4 | 深链与复制引用 | `permalink.ts`、`citation.ts`、App、详情 | `?e=` 展开/滚动；复制格式正确；未知 slug 提示 | 0.75d | A3 |
| A5 | 种子静态页与 sitemap | `build-pages.mjs`、模板 | 148 页、canonical、JSON-LD、sitemap | 1d | A2 |
| A6 | 静态页检查 | `check-pages.mjs`、`check-pages-selftest.mjs` | 全量断言通过；21 个反例自检全部命中 | 0.5d | A5 |
| A7 | 基准集与覆盖率 | `benchmark.mjs`、`check-coverage.mjs`、自检 | 112/126 · 88.9%；14 个具体缺口；删除种子后维度下降且退出码非零 | 1–1.5d | — |
| A8 | 本批发布与线上验证 | 发布记录 | 静态页、深链、引用、sitemap 实测 | 0.25d | A1–A7 |
| B1 | 状态分类与查询 | 迁移列、pipeline、timeline | 单源媒体进观察区；验证后晋级 | 1d | A1 |
| B2 | 观察区 UI | `RecentShelf.tsx`、App | 折叠、计数、展开、14 天窗口 | 0.5d | B1 |
| B3 | 修订记录 | `revisions.mjs`、pipeline、详情 | 5 字段 diff；20 条上限；种子不被覆盖 | 1d | A1 |
| B4 | 链接巡检 | `links.mjs`、pipeline、详情、status | 200/404/超时分类；6 条/次；不超时 | 2d | A1 |
| B5 | 为什么重要 | 种子 `why`、回填、详情 | ≥80 种子全覆盖；自动条目无编辑判断 | 0.5d + 内容 0.5d | A2 |
| B6 | 本批发布与验证 | 发布记录 | 观察区、修订、链接状态线上可见 | 0.25d | B1–B5 |
| C1 | Atom feed | `handler.mjs`、`api.ts`、页脚 | 可解析、40 条上限、无种子 | 0.5d | B1 |
| C2 | 本周新增（可选） | 筛选条 | 只显示非种子、7 天内 | 0.5d | B1 |
| C3 | 引用与来源说明更新 | 页脚、文档 | 与实现一致，不夸大 | 0.25d | A4/B4 |

### A5–A6 实施记录（2026-10-24）

- **地址形式**：平台禁用目录索引，静态页落为 `dist/e/<slug>.html`。canonical、sitemap、页内引用与前端「静态引用页」链接统一使用 `.html`；`?e=` 仍用于自动条目和站内展开。
- **产出规模**：148 个种子页、183 条来源链接、149 条 sitemap（首页 + 148 页）、robots.txt、首页 `WebSite` + `Organization` JSON-LD。种子引用指向静态页，自动条目引用仍指向 `/?e=<slug>`。
- **来源与构建日期**：站点源地址集中在 `site.config.mjs`，可用环境变量 `SITE_ORIGIN` 覆盖；引用中的访问日期取构建日期。
- **A6 检查范围**：页面集合与孤儿页、doctype/lang/charset/viewport、标题与描述、canonical/OG、来源数量与标题、证据链接双向外链集合、HTML 转义、`undefined/null` 泄漏、唯一 JSON-LD 且无脚本、无外部子资源、JSON-LD 字段与 `citation`、构建日期一致性、引用全文与 canonical/构建日期一致、sitemap XML 平衡/顺序/lastmod/去重、robots、首页 JSON-LD 与本地资源存在性。
- **反例自检**：`scripts/check-pages-selftest.mjs` 在临时目录复制真实 `dist`，先跑一次未修改副本作为对照，再逐项注入 20 种缺陷（缺页、孤儿页、错误 canonical、错误 JSON-LD、断链、未转义 `&`、错误访问日期、来源计数、未知内链、外部样式/脚本、sitemap 缺项/重复/lastmod、robots、首页描述漂移、首页 JSON-LD 重复与 SearchAction、缺失本地资源），断言每条都被对应规则捕获。当前 21/21 通过。
- **命令**：`npm run check:pages`（真实构建）、`npm run check:pages:selftest`（检查器自检）、`npm run check:pipeline`（采集管线）。

### A7 实施记录（2026-10-24）

- **基准集**：首版 126 条，覆盖 1910s–2020s 的历史主干、各头部厂商旗舰节点、中文侧重要事件与当前模型线。其中 58 条对应 `importance ≥ 85` 的种子，规则要求全部出现，否则判定基准集本身不完整。
- **匹配**：复用 `titleTokens` 与 `modelKeyOf`；命中条件为共享特征词 ≥2、模型键相同、或标题包含唯一词组。年份相差超过 1 年不匹配；每个基准条目最多占用一条档案事件，避免一条宽泛事件同时满足多个条目。
- **分层结果**（离线录制上游 + 假 Supabase，208 条事件）：总量 112/126 = 88.9%；2020s 84.2%、2010s 94.1%、1980s 80.0%；OpenAI 95.7%、Google 85.0%、Anthropic 100%、Meta 80%。阈值：总量 ≥85%，期望数 ≥5 的年代 ≥70%、厂商 ≥60%，高重要度种子必须进入基准集。
- **缺口**（按重要度）：Gemini 1.5、Llama 2、Qwen2.5、DeepSeek-V2、Mixtral、ViT、LoRA、Bletchley 峰会、PaLM、豆包、NIST AI RMF、Whisper、2018 图灵奖、XCON。每条含 id、年份、类别、厂商与一句核对说明，可直接转成待补种子任务。
- **不写库**：基准集只用于度量，覆盖检查在内存假库上先跑同步再统计；`coverage-report.json` 仅本地复盘并已加入 `.gitignore`。
- **自检**：`check-coverage-selftest.mjs` 验证基准通过、缺口可操作、58 条高重要度种子全覆盖、每条基准独占一行；删除 `turing-1950` 后总命中减 1、1950s 覆盖率从 100% 降至 80%、强制 100% 阈值失败；并以 `--exclude-slug` + `--require-total 1` 实测 CLI 退出码为 1。
- **命令**：`npm run check:coverage`、`npm run check:coverage:selftest`。诊断参数 `--exclude-slug`、`--require-total`、`--no-report` 仅用于本地验证。

### 建议执行顺序

1. **第 1 周**：A1 → A2 → A3 → A4；A7 可并行。周末发布 A 的前半段（slug + 引用），先拿到可用价值。
2. **第 2 周**：A5 → A6 → A8；完成静态页、sitemap、基准集报告，发布 A 完整版。
3. **第 3 周**：B1 → B2 → B3；完成观察区与修订记录。
4. **第 4 周**：B4 → B5 → B6；完成链接巡检与内容，发布 B。
5. **第 5 周**：C1 → C2 → C3；发布 C。

如果时间只够做一件事，做 A1–A4；如果只够做两件，第二件做 A5。这两项直接兑现「可引用」。

---

## 8. 验收清单

### 本地

- `npm run build`：TypeScript、Vite 构建、静态页生成全部通过。
- `npm run check:pipeline`：解析、聚类、幂等、种子保护、状态分类、修订 diff、链接分类全部通过。
- `npm run check:coverage`：输出总覆盖率、年代、厂商、类别四张分层表；低于阈值退出码非零。
- `npm run check:pages`：页数、标题、canonical、JSON-LD、来源链接、HTML 转义。
- 手工：`?e=` 展开与滚动、复制引用、未知 slug、观察区折叠、无 JS 时静态页可读。

### 云端

- 迁移成功，四表 + 新列 + 索引 + 策略可读；`requiredSchemaVersion=3`。
- 发布后：种子静态页 200 且来源可点；`?e=` 深链可用；`event?slug=` 可用。
- 同步一次：slug 回填、状态分类、链接巡检 notes 正常；总时长仍 ≤22 秒。
- `status` 返回 active/provisional 与链接健康计数；`feed` 返回合法 XML。
- 观察区有真实待观察条目且能晋级；主时间轴数量不回退。

### 不回归

- 存量 249 条标题、摘要、日期、重要度不变。
- 种子条目的标题与摘要永不被自动合并覆盖。
- 原有筛选、搜索、年份跳转、同步面板、置信度徽标正常。
- 仍无 DELETE；浏览器仍不接触数据库地址与密钥。

---

## 9. 风险与取舍

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 静态页与 SPA 内容重复 | 搜索权重分散 | canonical 指向静态页；SPA 查询页不做 canonical |
| 托管不支持目录索引 | `/e/<slug>/` 404 | 发布首日实测，退回 `.html` 形式 |
| canonical 域名写错 | 结构化数据无效 | 统一 `SITE_ORIGIN`；无法确定时省略而不是猜测 |
| 新表扩大匿名写面 | 误写/滥用 | 只允许 select/insert/update，无 DELETE；写入只经 Function；单次上限 |
| 链接巡检挤占同步预算 | 同步超时或失败 | 6 个并行、4.5 秒超时、与抓取重叠、失败只记 notes |
| 观察区误伤新条目 | 新鲜内容不可见 | 观察区始终可见 14 天；满足条件自动晋级；`?e=` 可直达 |
| 修订 JSON 膨胀 | 行体积变大 | 20 条上限，只记 6 个字段 |
| 「为什么重要」主观 | 争议 | 明确标注编辑判断；可修订、留痕 |
| 基准集成为新的形式主义 | 只覆盖容易的条目 | 分层阈值 + 厂商/年代维度 + 缺口清单，不接受单一总分 |
| 种子 why 回填覆盖合并结果 | 丢失自动证据 | 回填只写 `why/why_kind/slug`，不碰其余字段 |

---

## 10. 明确不采用

1. 七状态机、编辑/审核角色、2FA 后台、24 小时冷静期：与单人维护冲突，收益不足以抵消复杂度。
2. 「模型永远无法推到已发布」的人工闸门：本站是自动档案，采用「置信度 + 观察区」替代审批。
3. M1 的 100% 来源可点开硬阈值与「失效即下架」：改为「死链必须有存档或标注」。
4. 付费/备案域名 `aihist.net` 与自建服务器：只对自建站成立，当前平台站没有备案路径；先不迁移。
5. 邮件周刊：与「不对外发送消息」冲突；用 Atom 与站内观察区替代。
6. 开放式用户投稿：在流量与审核能力未验证前不开放。
7. S/A/B 人工定级与双人复核：单人项目无法执行；保留数值重要度与置信度，新增编辑判断文本。
8. 只覆盖 2017–2026 的基准集：与 1912 起的档案冲突，改为按年代分层。

---

## 11. 待 Owner 决策（含建议）

1. **静态页范围**：建议只做 148 条种子；自动条目用 `?e=`。全量静态页需要构建期读数据库，不可行且收益低。
2. **观察区窗口**：建议 14 天；30 天会让主时间轴长期缺失新内容。
3. **「为什么重要」的写作方式**：建议 AI 起草、人工改定并标注编辑判断；不接受未改定的模型文本。
4. **是否购买独立域名**：建议暂不购买；等 P0/P1 完成、访问数据出来后再决定是否自建与备案。

---

## 附录 A｜引用与结构化数据样例

引用文本：

```
图灵发表《计算机器与智能》，提出模仿游戏[EB/OL]. AI 纪年, 1950-10. https://<origin>/e/turing-1950.html（访问日期：2026-10-24）.
```

静态页 JSON-LD：

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "图灵发表《计算机器与智能》，提出模仿游戏",
  "alternativeHeadline": "Computing Machinery and Intelligence",
  "datePublished": "1950-10",
  "inLanguage": "zh-CN",
  "url": "https://<origin>/e/turing-1950/",
  "isPartOf": {
    "@type": "WebSite",
    "name": "AI 纪年",
    "url": "https://<origin>/"
  },
  "publisher": { "@type": "Organization", "name": "AI 纪年" },
  "citation": ["https://doi.org/10.1093/mind/LIX.236.433"],
  "about": [{ "@type": "Thing", "name": "图灵测试" }]
}
```

日期保留原有精度（年/月/日），不为结构化数据编造具体日。

---

## 附录 B｜基准集条目样例

```js
export const BENCHMARK = [
  { id: "turing-1950", year: 1950, tokens: ["turing", "computing machinery"], category: "research" },
  { id: "alexnet-2012", year: 2012, tokens: ["alexnet", "imagenet"], category: "research" },
  { id: "chatgpt-2022", year: 2022, tokens: ["chatgpt"], category: "model", vendor: "OpenAI" },
  { id: "chatglm-6b-2023", year: 2023, tokens: ["chatglm-6b"], category: "model", vendor: "智谱" },
];
```

匹配只使用名称特征，不使用摘要；缺口输出示例：

```
年代 1990s   12/14 (86%)   缺：TD-Gammon 复现、第五代计算机评估
厂商 智谱     11/12 (92%)
总体         78/90 (87%)
```

---

## 附录 C｜发布检查命令

```bash
npm run build
npm run check:pipeline
npm run check:coverage
npm run check:pages
node dev/preview.mjs 8000   # 另开终端，验证 handler 分支
```

线上只验证发布后站点：静态页、`?e=`、`event?slug=`、`status`、`feed`、链接状态。发布预览只渲染静态文件，不执行 Function，不能用它判定接口通过。
