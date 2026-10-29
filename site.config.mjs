/**
 * Publication metadata used by the build-time static pages.
 *
 * The canonical origin cannot be discovered at build time: prepare_site does
 * not run the build and the descriptor does not carry the host. Set
 * SITE_ORIGIN to override the default when building for another deployment.
 */
const DEFAULT_ORIGIN = "https://aihist.net";

function normalizeOrigin(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("SITE_ORIGIN is empty");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SITE_ORIGIN is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`SITE_ORIGIN must use http(s): ${value}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`SITE_ORIGIN must be a bare origin: ${value}`);
  }
  return url.origin;
}

export const SITE_ORIGIN = normalizeOrigin(process.env.SITE_ORIGIN || DEFAULT_ORIGIN);
export const SITE_NAME = "AI 纪年";
export const SITE_TITLE = "AI 纪年 · 人工智能发展编年史";
export const SITE_DESCRIPTION =
  "AI 纪年：记录人工智能的关键事件、大模型发布与重要研究。条目来自公开接口与官方公告，经去重与交叉验证入档。";

/**
 * Webmaster verification codes, injected into the homepage <head> as
 * <meta name="...-site-verification" content="..."> when set. They are public
 * tags, not secrets, but they only exist after the domain is added to the
 * matching console — see docs/推广/AI纪年SEO_GSC与百度站长_资源提交手册_v1.md.
 * The GSC property here is verified by DNS (domain property), so GOOGLE_CODE
 * stays empty unless a URL-prefix property ever needs its own meta tag.
 */
function verifyCode(raw, label) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!/^[\w=+\/-]{4,128}$/.test(value)) {
    throw new Error(`${label} does not look like a verification code`);
  }
  return value;
}

export const BAIDU_CODE = verifyCode(process.env.BAIDU_CODE, "BAIDU_CODE");
export const GOOGLE_CODE = verifyCode(process.env.GOOGLE_CODE, "GOOGLE_CODE");
