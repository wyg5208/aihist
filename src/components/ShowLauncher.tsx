import { useCallback, useState } from "react";
import type { ShowController } from "../hooks/useShow";

/** 用过一次就不再提醒——“显眼”是第一眼的义务，不该变成常驻的噪声。 */
const SEEN_KEY = "aihist.show.seen";

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 放映入口。
 *
 * 三套版式的顶栏各不相同，各自塞一个按钮意味着三份实现、三种位置；所以
 * 入口做成一颗统一的浮动胶囊，右下角落位，三套皮肤下都读同一组令牌。
 *
 * 它是页面上唯一的反白实心块：底用 `--ink`、字用 `--paper`，于是浅色两套是
 * 墨底奶字、极光是奶底墨字——无论哪种皮肤，对比度都高于周围的纸面与卡片。
 */
export function ShowLauncher({ show }: { show: ShowController }) {
  const [seen, setSeen] = useState(readSeen);

  const open = useCallback(() => {
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* 隐私模式下存不了，只是下次还会呼吸一次 */
    }
    show.open();
  }, [show]);

  if (show.phase !== "closed") return null;
  const ready = show.count > 0;

  return (
    <button
      type="button"
      className={seen ? "show-launcher is-seen" : "show-launcher"}
      onClick={open}
      aria-haspopup="dialog"
      disabled={!ready}
      title={ready ? "全屏放映，一屏一条记录" : "档案尚未载入"}
    >
      <span className="show-launcher-glyph" aria-hidden="true">
        ▶
      </span>
      <span className="show-launcher-label">
        <span className="show-launcher-title">自动演示</span>
        <span className="show-launcher-sub">一屏一条 · 可分享</span>
      </span>
      {ready ? <span className="show-launcher-count">{show.count}</span> : null}
    </button>
  );
}
