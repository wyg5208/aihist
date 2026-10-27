import type { ReactNode } from "react";
import { ARCHIVE_START_YEAR } from "../lib/eras";

interface Props {
  onStandard: () => void;
}

/**
 * The four-column footer, on the dark band that closes the page. Column one is
 * what the archive is, columns two and three are the addresses a reader might
 * want next, column four is the subscribe form's door — so the two important
 * actions are reachable from the bottom of any scroll depth.
 *
 * The collection and evidence policy lives in a full-width block above the
 * copyright line instead of a fourth narrow column: it is the text readers
 * quote back at us, and 30 characters of measure would mangle it.
 */
export function SiteFooter({ onStandard }: Props) {
  return (
    <footer className="deep-band mt-14 border-t border-[var(--deep-rule)]">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-5 pt-10 sm:px-6 lg:max-w-[1480px] lg:px-8 2xl:max-w-[1760px] 2xl:px-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.8fr_0.8fr_1.2fr] lg:gap-10">
          <div>
            <a href="/" className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="font-serif text-[19px] leading-none">AI 纪年</span>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.2em]"
                style={{ color: "var(--on-deep-soft)" }}
              >
                Chronicle
              </span>
            </a>
            <p
              className="mt-3 max-w-[36ch] text-[13px] leading-[1.75]"
              style={{ color: "var(--on-deep-soft)" }}
            >
              按年份编排人工智能的关键事件、模型发布与重要研究。条目来自公开接口与官方公告，
              经过去重与交叉验证入档；置信度、证据与评审票型随每条记录公开。
            </p>
          </div>

          <FooterColumn title="浏览">
            <a href="#main">时间轴</a>
            <button type="button" onClick={onStandard} className="text-left">
              收录标准
            </button>
            <a href="/admin/">管理台</a>
          </FooterColumn>

          <FooterColumn title="开放">
            <a href="/api/v1/open/apply">API 申请</a>
            <a href="/api/v1/subscribe?src=footer">订阅更新</a>
            <a href="/api/v1/correct">发现错误</a>
          </FooterColumn>

          <div>
            <h3 className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent-mark)]">
              每周一封
            </h3>
            <p
              className="mt-3 text-[13px] leading-[1.7]"
              style={{ color: "var(--on-deep-soft)" }}
            >
              只写这一周新增了什么，附来源与原链。不发广告，随时退订。
            </p>
            <a className="btn btn-band btn-sm mt-3.5" href="/api/v1/subscribe?src=footer">
              订阅更新
            </a>
          </div>
        </div>

        <div
          className="mt-9 grid gap-6 border-t pt-6 text-[12.5px] leading-[1.75] sm:grid-cols-2 lg:gap-10"
          style={{ borderColor: "var(--deep-rule)", color: "var(--on-deep-soft)" }}
        >
          <p>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent-mark)]">
              采集
            </span>
            <br />
            OpenRouter、Hugging Face、arXiv、Hacker News、OpenAI 与 Google 官方博客、
            Anthropic 站点地图，以及 TechCrunch、The Verge、MIT Technology Review；
            中文侧采集量子位、InfoQ 中国、钛媒体与雷峰网。同一来源只计一次，
            跨类别命中才升级为「已证实」。
          </p>
          <p>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent-mark)]">
              边界
            </span>
            <br />
            采集与访问完全解耦：后台定时任务每天 01:05 运行一次，浏览页面不发起任何同步。
            自动条目先经规则预筛，再由五家厂商各一席的模型评审：至少三票同意、中位分不低于 75
            才收录；票型分裂或评审不可用时暂缓并隐藏。摘要明确标注人工校订、模型生成或来源摘录。
          </p>
        </div>

        <div
          className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-t pt-4 font-mono text-[11.5px] uppercase tracking-[0.1em]"
          style={{ borderColor: "var(--deep-rule)", color: "var(--on-deep-soft)" }}
        >
          <span>
            AI Chronicle · Vol. I · {ARCHIVE_START_YEAR}—
            {new Date().getFullYear()}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <a href="/api/v1/subscribe?src=footer" className="underline decoration-[var(--deep-rule)]">
              订阅
            </a>
            <a href="/api/v1/open/apply" className="underline decoration-[var(--deep-rule)]">
              API
            </a>
            <a href="/api/v1/correct" className="underline decoration-[var(--deep-rule)]">
              纠错
            </a>
            <span>数据来自公开接口 · 观点与事实以原链为准</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent-mark)]">
        {title}
      </h3>
      <div
        className="mt-3 flex flex-col items-start gap-2 text-[13.5px]"
        style={{ color: "var(--on-deep-soft)" }}
      >
        {children}
      </div>
    </div>
  );
}
