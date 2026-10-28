/**
 * 把 `public/visuals/*.jpg` 转成放映用的 WebP 两档。
 *
 * 为什么是两档：画框在 900px 断点以上是视口宽的 47%，以下占满整宽；实测
 * 桌面画框约 676px，900w 的 JPEG 是 1.33 倍过采样。760w 覆盖 DPR1 桌面与
 * 窄屏，900w 覆盖 DPR2 桌面与 DPR3 手机——再高档位在这个画框里看不出来。
 *
 * 用本机 ffmpeg 的 libwebp，不引入新依赖：
 *   node scripts/build-visuals.mjs            # 只补缺失的
 *   node scripts/build-visuals.mjs --force    # 全部重出
 * 产物与 JPEG 同名同目录，`.jpg` 换成 `.webp` / `-760.webp`。
 *
 * 换图不要原地覆盖同名 JPEG：`/visuals/` 在 Vercel 上缓存 30 天（再配 7 天
 * stale-while-revalidate），覆写后读者仍会拿旧图。改文件名（`x.jpg` →
 * `x-v2.jpg`）、同步 `src/data/visuals.json`，再跑这个脚本。旧档位不会自动
 * 删除——它们已经是另一个文件名，要清就手工清。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const DIR = "public/visuals";
const force = process.argv.includes("--force");

/** 与 ShowSlide 的 <img sizes> 保持一致：900 断点以下整宽，以上 47%。 */
const VARIANTS = [
  { suffix: ".webp", width: 900, quality: 78 },
  { suffix: "-760.webp", width: 760, quality: 80 },
];

const sources = readdirSync(DIR).filter((name) => name.endsWith(".jpg"));
let encoded = 0;
let skipped = 0;

for (const name of sources) {
  const input = join(DIR, name);
  const stem = basename(name, ".jpg");
  for (const variant of VARIANTS) {
    const output = join(DIR, `${stem}${variant.suffix}`);
    if (!force && existsSync(output)) {
      skipped += 1;
      continue;
    }
    // 只缩不放：原图窄于目标档位时按原宽输出，避免虚撑。
    const filter = `scale='min(${variant.width},iw)':-2:flags=lanczos`;
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-vf",
        filter,
        "-c:v",
        "libwebp",
        "-quality",
        String(variant.quality),
        "-compression_level",
        "6",
        output,
      ],
      { stdio: "inherit" }
    );
    encoded += 1;
  }
}

const total = (suffix) =>
  sources.reduce((sum, name) => {
    const file = join(DIR, basename(name, ".jpg") + suffix);
    return sum + (existsSync(file) ? statSync(file).size : 0);
  }, 0);

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
console.log(
  `encoded ${encoded}, skipped ${skipped}, sources ${sources.length}\n` +
    `  jpg        ${kb(total(".jpg"))}\n` +
    `  webp 900   ${kb(total(".webp"))}\n` +
    `  webp 760   ${kb(total("-760.webp"))}`
);
