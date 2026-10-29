/**
 * Baidu 主动推送（sitemap API）：把 dist/sitemap.xml 里的 URL 推给百度收录。
 *
 *   node scripts/push-baidu.mjs --dry-run              只打印将推送的 URL
 *   node scripts/push-baidu.mjs --limit 20             只推前 20 条（首次配额试探）
 *   BAIDU_PUSH_SITE=https://aihist.net BAIDU_PUSH_TOKEN=xxx node scripts/push-baidu.mjs
 *
 * token 在百度站长平台（ziyuan.baidu.com）→ 资源管理 → 我的资源 → 普通收录 →
 * 主动推送 页面获取，是凭证：只放环境变量，不要写进仓库。
 * 接口每次最多 1 万条；本脚本按 --batch（默认 500）分批 POST。
 * 退出码：0 全部批次无失败；1 存在失败或前置条件不满足。
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const args = { dryRun: false, limit: 0, batch: 500, file: "dist/sitemap.xml" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--limit") {
      args.limit = Number(argv[(i += 1)]);
      if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error("--limit 需要正整数");
    } else if (arg === "--batch") {
      args.batch = Number(argv[(i += 1)]);
      if (!Number.isInteger(args.batch) || args.batch < 1 || args.batch > 10000) {
        throw new Error("--batch 需要 1..10000 的整数");
      }
    } else if (arg === "--file") {
      if (!String(argv[i + 1] || "").startsWith("--")) args.file = argv[(i += 1)];
      else throw new Error("--file 需要路径");
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function readLocs(file) {
  const xml = await readFile(file, "utf8");
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
    .map((match) => decodeEntities(match[1].trim()))
    .filter((loc) => /^https?:\/\/\S+$/.test(loc));
  if (locs.length === 0) throw new Error(`${file} 里没有可用的 <loc>，先跑 npm run build`);
  return locs;
}

const RESPONSE_CODES = {
  4: "site 参数错误（站点与资源不匹配或非法）",
  5: "site 参数为空或非法",
  6: "超过每日推送配额，明日再试",
  7: "推送 token 失效",
  8: "token 与站点不匹配",
  9: "token 参数为空或非法",
  14: "推送的站点与 token 所属站点不一致",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const site = String(process.env.BAIDU_PUSH_SITE || "").trim();
  if (!args.dryRun) {
    if (!site) throw new Error("缺少 BAIDU_PUSH_SITE，例如 https://aihist.net");
    if (!/^https?:\/\//.test(site)) throw new Error("BAIDU_PUSH_SITE 必须是 http(s) 站点地址");
  }
  const token = String(process.env.BAIDU_PUSH_TOKEN || "").trim();
  if (!args.dryRun && !token) {
    throw new Error("缺少 BAIDU_PUSH_TOKEN（百度站长平台 → 普通收录 → 主动推送）");
  }

  const file = join(PROJECT_ROOT, args.file);
  let locs = await readLocs(file);
  const total = locs.length;
  if (args.limit > 0) locs = locs.slice(0, args.limit);

  console.log(`来源      ${args.file}（${total} 条，本次 ${locs.length} 条）`);
  if (args.dryRun) {
    for (const loc of locs) console.log(loc);
    console.log("dry-run：未向百度发送任何请求。");
    return 0;
  }

  const endpoint = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(
    site
  )}&token=${encodeURIComponent(token)}`;
  let remaining = locs;
  let success = 0;
  let notSame = 0;
  let failed = false;

  for (let offset = 0; offset < remaining.length; offset += args.batch) {
    const chunk = remaining.slice(offset, offset + args.batch);
    console.log(`推送      ${offset + 1}-${offset + chunk.length} / ${remaining.length}`);
    let payload = null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: chunk.join("\n"),
      });
      const text = await response.text();
      try {
        payload = JSON.parse(text);
      } catch {
        console.error(`响应不是 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
        failed = true;
        continue;
      }
    } catch (error) {
      console.error(`请求失败：${error.message}`);
      failed = true;
      continue;
    }

    if (typeof payload.error_msg === "string" || typeof payload.error === "number") {
      const code = Number(payload.error);
      console.error(
        `批次失败：error=${payload.error ?? "未知"} ${payload.error_msg || RESPONSE_CODES[code] || ""}`.trimEnd()
      );
      failed = true;
      continue;
    }
    const batchSuccess = Number(payload.success) || 0;
    const batchNotSame = Array.isArray(payload.not_same) ? payload.not_same.length : 0;
    success += batchSuccess;
    notSame += batchNotSame;
    console.log(
      `          成功 ${batchSuccess}，mis 不在站点下 ${payload.disp_q ?? "?"}，剩余配额 ${payload.left ?? "?"}` +
        (batchNotSame ? `，not_same ${batchNotSame} 条：${payload.not_same.slice(0, 3).join(", ")}` : "") +
        (payload.invalid ? `，invalid ${payload.invalid.length} 条` : "")
    );
  }

  console.log(`合计      成功 ${success} / ${remaining.length}${notSame ? `，not_same ${notSame}` : ""}`);
  if (failed || success !== remaining.length) {
    console.error("存在未成功的推送，请对照上方批次输出排查（常见：配额、token、站点不一致）。");
    return 1;
  }
  return 0;
}

process.exitCode = await main().catch((error) => {
  console.error(`push-baidu: ${error.message}`);
  return 1;
});
