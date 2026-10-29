# AI 纪年 SEO · GSC 与百度站长资源提交手册 v1

> **版本**：v1.0（2026-10-30）
> **适用站点**：`https://aihist.net`（Vercel 托管，push main 自动部署；API 在 `api.aihist.net`）
> **前置状态**：Google Search Console **域名资源已验证（DNS）**；百度站长平台**未注册**。
> **用途**：把 173 个 URL（首页 + 172 张静态条目页）正式交给两大搜索源收录。本手册假设读者是站点维护者本人，所有终端命令在项目根目录执行。

---

## 一、本次改造动了什么（先读这段）

站点 SEO 基建本来就有：`robots.txt`、`sitemap.xml`（173 URL）、172 张静态条目页（canonical / OG / Article JSON-LD / `index,follow`）、首页 WebSite+Organization JSON-LD。这次补齐的是"站长平台接入"缺的四块：

| 改动 | 文件 | 说明 |
|---|---|---|
| 验证标签注入支持 | `site.config.mjs`、`scripts/build-pages.mjs` | 设 `BAIDU_CODE` / `GOOGLE_CODE` 环境变量，构建时往首页 `<head>` 注入对应 `*-site-verification` meta；不设则不注入，产出不变 |
| 百度纯文本索引 | `scripts/build-pages.mjs` → `dist/sitemap_baidu.txt` | 与 `sitemap.xml` 同一 URL 清单、一行一条。百度 sitemap 读取器对 XML 挑剔，纯文本是它的主格式 |
| 主动推送脚本 | `scripts/push-baidu.mjs`（`npm run push:baidu`） | 读 `dist/sitemap.xml`，按批 POST 到百度 `data.zz.baidu.com/urls`；token 只从环境变量读，不落仓库 |
| 门禁同步 | `scripts/check-pages.mjs`（+selftest 2 个新用例）、`vercel.json` | `sitemap_baidu.txt` 必须与 `sitemap.xml` 一一对应；验证标签数量与 env 一致性校验；`/sitemap_baidu.txt` 缓存 1 小时 |

**为什么 Google 不需要加标签**：GSC 域名资源（DNS 验证）天然覆盖 `aihist.net` 下所有路径与协议，无需 HTML 标签。只有当你另建"URL 前缀资源"且拿不到 DNS 时，才需要把它的 code 填进 `GOOGLE_CODE`。

**一个要知道的边界**：首页是纯客户端渲染的 React SPA，百度蜘蛛基本不执行 JS——所以百度侧真正能吃到的内容是 172 张静态条目页（这也是 sitemap 的主体）。首页在百度的展现会偏弱，属预期，不是故障。

---

## 二、Google Search Console：已验证，只剩提交

1. 打开 <https://search.google.com/search-console>，确认域名资源 `aihist.net` 状态为"已验证"。若还没有资源，点左上角齿轮 → 添加资源 → 选"**域名**"，按提示去 DNS 加一条 `TXT` 记录（记录名 `@` 或留空，值为给的 `google-site-verification=...`）。
2. 左侧「索引 → 站点地图（sitemap）」→ 输入 `https://aihist.net/sitemap.xml` → **提交**。成功几分钟后会显示"已成功提交 / 发现 173 个网址"。
3. 左侧「网页」（旧版叫「网址检查」）：对 `https://aihist.net/` 和 2~3 张代表性条目页（如 `/e/turing-1950.html`、`/e/alexnet-2012.html`）各跑一次"请求索引"，加速首次抓取。批量页面**不要**逐个提交，靠 sitemap 即可。
4. 「设置 → 常规设置 → 域名所有权验证」不用动，DNS 已覆盖。

验收（本地终端可直接跑）：

```bash
curl -sI https://aihist.net/sitemap.xml | head -5   # 200, Cache-Control max-age=3600
curl -s  https://aihist.net/robots.txt              # 含 Sitemap: https://aihist.net/sitemap.xml
```

---

## 三、百度站长平台：注册 → 验证 → 提交 → 推送

### 3.1 添加资源并拿验证码

1. 打开 <https://ziyuan.baidu.com/>，用百度账号登录（没账号先注册，需实名认证）。
2. 「资源管理 → 我的资源 → 添加资源网站」：属性名填 `https://aihist.net`（**协议头必须与线上完全一致**，百度按字符串匹配），站点类型选"网站"。
3. 验证方式选"**HTML 标签验证**"，复制形如 `content="xxxxxx"` 里的 **code 值**（不是整段标签）。

### 3.2 把 code 装进构建（两种做法，选 A）

**做法 A（推荐）：Vercel 环境变量**。code 是公开 meta，放 env 只是为了不把平台值写进仓库。到 Vercel 项目 → Settings → Environment Variables，添加：

```text
BAIDU_CODE = <刚复制的 code 值>
```

Scope 勾选 Production，保存后到 Deployments 手动触发一次 Redeploy（或任意一次 push）。构建日志里应出现：

```text
webmaster    验证标签 baidu
```

**做法 B（备用）：直接写死**。把 code 交给我，我改 `site.config.mjs` 里 `BAIDU_CODE` 的默认值并重新上线。少一层配置，但平台值进仓库。

上线后验收：

```bash
curl -s https://aihist.net/ | grep baidu-site-verification
# <meta name="baidu-site-verification" content="..." />
```

回到站长平台点「完成验证」。若提示失败，等 Vercel 部署真正生效（边缘缓存最多 1 小时）再试。

### 3.3 提交 sitemap

「资源管理 → 我的资源 → 选中站点 → 普通收录 → sitemap」→ 提交：

```text
https://aihist.net/sitemap_baidu.txt
```

（纯文本格式是百度主格式；XML 那个也可以顺带提交，二选一优先纯文本。）

### 3.4 主动推送（最有效的一步）

1. 同页「普通收录 → 主动推送」获取推送接口，形如：

```text
http://data.zz.baidu.com/urls?site=https://aihist.net&token=<TOKEN>
```

2. **token 是凭证，只放环境变量，绝不进仓库。** 本地 PowerShell：

```powershell
$env:BAIDU_PUSH_SITE = "https://aihist.net"
$env:BAIDU_PUSH_TOKEN = "<TOKEN>"
```

3. 先试探配额，再全量：

```powershell
npm run push:baidu -- --dry-run --limit 5   # 只打印，不发请求
npm run push:baidu -- --limit 20            # 小批量试推
npm run push:baidu                          # 全量 173 条（新站通常日配额 500~1000）
```

成功输出会有 `成功 N / 173，剩余配额 ...`。之后每次内容迭代上线，重跑一次全量推送即可（重复 URL 不扣配额，百度会按"已收录/待收录"处理）。

### 3.5 顺手开启的两项

- 「资源管理 → 普通收录」里若有"**自动收录**"代码位说明，首页是 SPA 不适用，跳过即可，主动推送 + sitemap 已够。
- 「链接提交 → 失败原因」每周看一次；「流量与关键词」在收录起量前是空的，属正常。

---

## 四、拿到百度 code 之后的收尾清单（交回给我执行）

1. 按做法 A 配好 Vercel `BAIDU_CODE`（或把 code 给我走做法 B），重新构建上线，确认构建日志出现 `验证标签 baidu`、线上 `curl` 能抓到 meta。
2. 本地跑 `npm run release:gate` 全绿（含新加的 `sitemap_baidu.txt` 一致性门禁）。
3. 用 `npm run push:baidu` 先 `--limit 20` 试推，再全量；把 `left` 配额回报。
4. 站长平台点「完成验证」+ 提交 `sitemap_baidu.txt`；GSC 提交 `sitemap.xml`。
5. 一两周后回看：GSC「索引 → 网页」收录数、百度「普通收录 → 流量和关键词」，据此决定是否给条目页补 `og:image` 提升点击率。

---

## 五、常见问题

- **改了 BAIDU_CODE 但线上海没有**：Vercel 的 env 只在下次构建生效，push 或手动 Redeploy。
- **验证说"未检测到标签"**：先 `curl` 确认线上首页 HTML 真有这行，再回平台重试；平台侧抓取有延迟。
- **推送报 error=6**：超日配额，明天再推剩余部分，或用 `--limit` 分批。
- **推送报 error=9/14**：`BAIDU_PUSH_SITE` 与站长平台属性名不一致（协议头/斜杠差一个都算错）。
- **会不会影响现有门禁**：不设 env 时构建产物与之前完全一致（除新增 `sitemap_baidu.txt` 与 robots 一行注释），门禁已全部跑绿。
