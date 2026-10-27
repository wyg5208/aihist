import { ThemeSwitcher } from "./ThemeSwitcher";

interface Props {
  onStandard: () => void;
}

/**
 * The sticky header. It carries the two things the archive cannot afford to
 * bury — subscribing and the open API — plus the palette switcher, and it stays
 * on screen while the timeline scrolls under it. The year headings inside the
 * timeline stick below it (`top-14`), so the two never overlap.
 *
 * Links here are only addresses that exist: the timeline anchor, the standard
 * dialog, the correction form, the open-API application and the console.
 */
export function SiteNav({ onStandard }: Props) {
  return (
    <header className="site-nav">
      <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-4 px-4 sm:px-6 lg:max-w-[1480px] lg:gap-6 lg:px-8 2xl:max-w-[1760px] 2xl:px-10">
        <a href="/" className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-serif text-[19px] leading-none text-[var(--ink)]">
            AI 纪年
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] sm:inline">
            Chronicle
          </span>
        </a>

        <nav
          aria-label="主导航"
          className="hidden items-center gap-4 md:flex lg:gap-5"
        >
          <a className="nav-link" href="#main">
            时间轴
          </a>
          <button type="button" className="nav-link" onClick={onStandard}>
            收录标准
          </button>
          <a className="nav-link" href="/api/v1/correct">
            发现错误
          </a>
          <a className="nav-link" href="/admin/">
            管理台
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher />
          <a className="btn btn-outline btn-sm hidden sm:inline-flex" href="/api/v1/open/apply">
            API 申请
          </a>
          <a className="btn btn-cta btn-sm" href="/api/v1/subscribe?src=nav">
            订阅更新
          </a>
        </div>
      </div>
    </header>
  );
}
