import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPages } from "./check-pages.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_DIST = join(PROJECT_ROOT, "dist");

const TURING = "turing-1950";
const LENET = "lenet-1989";
const CHATGPT = "chatgpt-2022";

async function edit(file, transform) {
  const before = await readFile(file, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`mutation had no effect on ${file}`);
  await writeFile(file, after, "utf8");
}

function pageFile(ctx, slug) {
  return join(ctx.dist, "e", `${slug}.html`);
}

function replaceOnce(html, needle, replacement) {
  if (!html.includes(needle)) throw new Error(`missing token: ${needle}`);
  return html.replace(needle, replacement);
}

const cases = [
  {
    name: "control",
    ok: true,
    mutate: async () => {},
  },
  {
    name: "missing page",
    expect: `missing page: /e/${CHATGPT}.html`,
    mutate: async (ctx) => {
      await unlink(pageFile(ctx, CHATGPT));
    },
  },
  {
    name: "orphan page",
    expect: "orphan page: /e/not-a-seed.html",
    mutate: async (ctx) => {
      await cp(pageFile(ctx, TURING), join(ctx.dist, "e", "not-a-seed.html"));
    },
  },
  {
    name: "wrong canonical",
    expect: "canonical is wrong",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(
          html,
          /<link rel="canonical" href="[^"]+"/.exec(html)?.[0] || "",
          '<link rel="canonical" href="https://example.com/e/turing-1950.html"'
        )
      );
    },
  },
  {
    name: "wrong JSON-LD type",
    expect: "JSON-LD type",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(html, '"@type":"Article"', '"@type":"BlogPosting"')
      );
    },
  },
  {
    name: "broken JSON-LD",
    expect: "page JSON-LD is not valid JSON",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(html, '"headline":', '"headline"')
      );
    },
  },
  {
    name: "missing evidence link",
    expect: "evidence link missing for https://doi.org/10.1093/mind/LIX.236.433",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(
          html,
          'href="https://doi.org/10.1093/mind/LIX.236.433"',
          'href="https://example.com/gone"'
        )
      );
    },
  },
  {
    name: "unescaped ampersand",
    expect: "unescaped ampersand",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, LENET), (html) =>
        replaceOnce(html, "AT&amp;T", "AT&T")
      );
    },
  },
  {
    name: "wrong citation access date",
    expect: "citation text is missing or inconsistent",
    mutate: async (ctx) => {
      if (!ctx.buildDate) throw new Error("control build date is unavailable");
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(
          html,
          `（访问日期：${ctx.buildDate}）`,
          "（访问日期：1999-01-01）"
        )
      );
    },
  },
  {
    name: "source heading count",
    expect: "source heading does not match the source count",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(html, "<h2>人工校订来源 · 2</h2>", "<h2>人工校订来源 · 3</h2>")
      );
    },
  },
  {
    name: "unknown internal link",
    expect: "internal link is not a known archive address",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(html, 'href="/?e=turing-1950"', 'href="/?e=not-a-seed"')
      );
    },
  },
  {
    name: "injected external stylesheet",
    expect: "page loads an external subresource",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(
          html,
          "</head>",
          '<link rel="stylesheet" href="https://cdn.example.com/page.css">\n</head>'
        )
      );
    },
  },
  {
    name: "injected inline script",
    expect: "expected exactly one JSON-LD script and no executable JavaScript",
    mutate: async (ctx) => {
      await edit(pageFile(ctx, TURING), (html) =>
        replaceOnce(html, "</body>", "<script>void 0</script>\n</body>")
      );
    },
  },
  {
    name: "sitemap missing url",
    // Derived from the control run: the pristine sitemap is the source of truth,
    // so this assertion survives any change to the seed count.
    expect: (ctx) =>
      `sitemap: expected ${ctx.sitemapCount} urls, found ${ctx.sitemapCount - 1}`,
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "sitemap.xml"), (xml) =>
        replaceOnce(
          xml,
          /<url>(?:(?!<\/url>)[\s\S])*?\/e\/turing-1950\.html(?:(?!<\/url>)[\s\S])*?<\/url>/.exec(xml)?.[0] || "",
          ""
        )
      );
    },
  },
  {
    name: "sitemap duplicate url",
    expect: "sitemap: duplicate urls",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "sitemap.xml"), (xml) => {
        const blocks = [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map(
          (match) => match[0]
        );
        const last = blocks[blocks.length - 1];
        if (!last) throw new Error("sitemap has no url blocks");
        return replaceOnce(xml, "</urlset>", `${last}\n</urlset>`);
      });
    },
  },
  {
    name: "sitemap wrong lastmod",
    expect: "differs from page build date",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "sitemap.xml"), (xml) =>
        replaceOnce(
          xml,
          /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.exec(xml)?.[0] || "",
          "<lastmod>1999-01-01</lastmod>"
        )
      );
    },
  },
  {
    name: "sitemap_baidu.txt missing",
    expect: "sitemap_baidu.txt is missing",
    mutate: async (ctx) => {
      await unlink(join(ctx.dist, "sitemap_baidu.txt"));
    },
  },
  {
    name: "sitemap_baidu.txt drift",
    expect: "sitemap_baidu.txt: url list differs",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "sitemap_baidu.txt"), (text) =>
        replaceOnce(text, `${process.env.SITE_ORIGIN || "https://aihist.net"}/e/${TURING}.html\n`, "")
      );
    },
  },
  {
    name: "robots without sitemap",
    expect: "robots.txt: sitemap is not declared",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "robots.txt"), (text) =>
        text
          .split(/\r?\n/)
          .filter((line) => !line.trim().toLowerCase().startsWith("sitemap:"))
          .join("\n")
      );
    },
  },
  {
    name: "homepage description drift",
    expect: "homepage: description differs from site.config.mjs",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "index.html"), (html) =>
        replaceOnce(
          html,
          /(<meta\s+name="description"\s+content=")[^"]*(")/.exec(html)?.[0] || "",
          '<meta\n      name="description"\n      content="A different description"\n    />'
        )
      );
    },
  },
  {
    name: "homepage duplicated site JSON-LD",
    expect: "homepage: expected exactly one site JSON-LD block",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "index.html"), (html) =>
        replaceOnce(
          html,
          /<script type="application\/ld\+json" data-site-jsonld>[\s\S]*?<\/script>/.exec(html)?.[0] || "",
          (match) => `${match}\n${match}`
        )
      );
    },
  },
  {
    name: "homepage SearchAction",
    expect: "homepage: SearchAction must not be advertised",
    mutate: async (ctx) => {
      await edit(join(ctx.dist, "index.html"), (html) =>
        replaceOnce(
          html,
          '"@graph":[',
          '"potentialAction":{"@type":"SearchAction"},"@graph":['
        )
      );
    },
  },
  {
    name: "homepage missing asset",
    expect: "homepage: referenced asset is missing",
    mutate: async (ctx) => {
      const home = await readFile(join(ctx.dist, "index.html"), "utf8");
      const asset = /(?:src|href)="\/assets\/([^"]+)"/.exec(home)?.[1];
      if (!asset) throw new Error("homepage has no local asset reference");
      await unlink(join(ctx.dist, "assets", asset));
    },
  },
];

async function main() {
  const base = await mkdtemp(join(tmpdir(), "ai-chronicle-pages-"));
  let failed = 0;
  let index = 0;

  try {
    await cp(SOURCE_DIST, join(base, "dist"), { recursive: true });

    let buildDate = "";
    let sitemapCount = 0;
    for (const testCase of cases) {
      index += 1;
      const root = join(base, `case-${index}`);
      await cp(join(base, "dist"), join(root, "dist"), { recursive: true });
      const ctx = { root, dist: join(root, "dist"), buildDate, sitemapCount };

      let result = null;
      let setupError = "";
      try {
        await testCase.mutate(ctx);
        result = await checkPages({ root, quiet: true });
      } catch (error) {
        setupError = error instanceof Error ? error.message : String(error);
      }

      if (index === 1) {
        if (!result || !result.ok) {
          failed += 1;
          console.error("fail control: pristine copy did not pass");
          for (const message of result?.errors.slice(0, 5) || []) {
            console.error(`     ${message}`);
          }
        } else {
          buildDate = result.buildDate;
          sitemapCount = result.stats.sitemapUrls;
          console.log(
            `ok   control — pristine copy passes (${result.stats.pages} pages, sitemap ${sitemapCount})`
          );
        }
        continue;
      }

      if (setupError) {
        failed += 1;
        console.error(`fail ${testCase.name}: could not prepare mutation — ${setupError}`);
        continue;
      }
      if (testCase.ok) {
        if (result.ok) {
          console.log(`ok   ${testCase.name}`);
        } else {
          failed += 1;
          console.error(`fail ${testCase.name}: expected a pass, got ${result.errors[0]}`);
        }
        continue;
      }

      const wanted =
        typeof testCase.expect === "function"
          ? testCase.expect(ctx)
          : testCase.expect;
      const hit = result.errors.find((message) => message.includes(wanted));
      if (!result.ok && hit) {
        console.log(`ok   ${testCase.name} — ${hit}`);
      } else {
        failed += 1;
        const actual = result.ok
          ? "no errors reported"
          : result.errors.slice(0, 3).join(" | ");
        console.error(
          `fail ${testCase.name}: expected “${wanted}”, got ${actual}`
        );
      }
    }
    console.log(
      `\nStatic page self-test: ${cases.length - failed}/${cases.length} cases passed.`
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await rm(base, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
