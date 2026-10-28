import { useMemo, useState } from "react";
import type { TimelineItem } from "../types";
import { CATEGORY_META, CONFIDENCE_META, formatCount, summaryKindLabel } from "../lib/format";
import { plateSpec } from "../lib/plate";
import { visualCredit, visualFor } from "../lib/visuals";
import { useEventDetail } from "../hooks/useEventDetail";
import { VisualPlate } from "./VisualPlate";

interface Props {
  item: TimelineItem;
  onOpen: (item: TimelineItem) => void;
}

/** 年精度只有年份，月精度只有月份，日精度才写日子。 */
function dateTail(item: TimelineItem): string {
  const month = Number(item.sortDate.slice(5, 7));
  const day = Number(item.sortDate.slice(8, 10));
  if (item.datePrecision === "year") return "全年";
  if (item.datePrecision === "month") return `${month} 月`;
  return `${month} 月 ${day} 日`;
}

/**
 * 一屏一条记录：左边是视觉，右边是这一条的完整读法。
 *
 * 视觉优先级是「登记过的真图 → 程序化图版」。真图加载失败也退回图版，
 * 所以放映永远不会出现破图；没有登记图的条目本来就用图版，不会留空。
 */
export function ShowSlide({ item, onOpen }: Props) {
  const { detail, loading } = useEventDetail(item.id, true);
  const visual = visualFor(item);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const spec = useMemo(() => plateSpec(item), [item]);
  const showImage = Boolean(visual) && visual?.src !== brokenSrc;
  const category = CATEGORY_META[item.category];
  const confidence = CONFIDENCE_META[item.confidence];

  return (
    <article className="show-slide">
      <figure className="show-figure" data-visual={showImage ? visual?.kind : "plate"}>
        {showImage && visual ? (
          <img
            className="show-photo"
            src={visual.src}
            alt={visual.alt}
            style={
              visual.cover || visual.fit
                ? { objectPosition: visual.cover, objectFit: visual.fit }
                : undefined
            }
            onError={() => setBrokenSrc(visual.src)}
          />
        ) : (
          <VisualPlate spec={spec} />
        )}
        <figcaption className="show-credit">
          {showImage && visual ? (
            <>
              {visualCredit(visual)}
              {visual.sourceUrl ? (
                <a
                  className="show-credit-src"
                  href={visual.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="打开原始文件页核对这张图与它的授权"
                >
                  原图 ↗
                </a>
              ) : null}
            </>
          ) : (
            `编年图版 No.${String(spec.plateNo).padStart(3, "0")} · 依类别与标签生成`
          )}
        </figcaption>
      </figure>

      <div className="show-copy">
        <div className="show-copy-inner">
          <p className="show-rail">
            <span className="show-year">{item.year}</span>
            <span className="show-tail">{dateTail(item)}</span>
            <span className="show-cat">{category.label}</span>
          </p>

          <h2 className="show-headline">{item.title}</h2>
          {item.titleEn && item.titleEn !== item.title ? (
            <p className="show-en">{item.titleEn}</p>
          ) : null}

          <dl className="show-facts">
            <div>
              <dt>机构</dt>
              <dd>{item.organization || "—"}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{item.modelName || "—"}</dd>
            </div>
            <div>
              <dt>证据</dt>
              <dd>
                {formatCount(item.sourceCount)} 条 · {(item.sourceFamilies || []).length} 类来源
              </dd>
            </div>
            <div>
              <dt>置信度</dt>
              <dd>{confidence.label}</dd>
            </div>
          </dl>

          <p className="show-summary" aria-live="polite">
            {detail?.summary || (loading ? "正在读取摘要…" : "这一条暂无摘要，可在档案中查看证据来源。")}
          </p>

          <div className="show-foot">
            <ul className="show-tags">
              {(item.tags || []).slice(0, 5).map((tag) => (
                <li key={tag} className="show-tag">
                  {tag}
                </li>
              ))}
            </ul>
            <button type="button" className="show-open" onClick={() => onOpen(item)}>
              在档案中打开 →
            </button>
          </div>

          {detail ? <p className="show-kind">{summaryKindLabel(detail.summaryKind)}</p> : null}
        </div>
      </div>
    </article>
  );
}
