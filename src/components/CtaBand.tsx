/**
 * The closing band: one more chance to subscribe or ask for a key, after the
 * reader has actually read something. Same two actions as the header, worded for
 * the end of a visit, and the subscribe link keeps its own `?src=` so the
 * funnel can tell the four touch points apart.
 */
export function CtaBand() {
  return (
    <section className="deep-band mt-14 rounded-[calc(var(--radius)+2px)] px-5 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <h2 className="font-serif text-[22px] leading-tight tracking-[-0.01em] sm:text-[24px]">
            订阅，或直接把档案接进你的产品
          </h2>
          <p
            className="mt-2 max-w-[54ch] text-[13.5px] leading-6"
            style={{ color: "var(--on-deep-soft)" }}
          >
            每周一封邮件只写这一周新增了什么；开放 API 返回结构化事件、证据链接与置信度，
            免费额度每秒 5 次，通常 1 个工作日内开通。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <a className="btn btn-band" href="/api/v1/subscribe?src=band">
            订阅更新
          </a>
          <a className="btn btn-band-outline" href="/api/v1/open/apply">
            申请 API Key
          </a>
        </div>
      </div>
    </section>
  );
}
