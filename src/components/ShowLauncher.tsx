import type { ShowController } from "../hooks/useShow";

/**
 * 放映入口。
 *
 * 三套版式的顶栏各不相同，各自塞一个按钮意味着三份实现、三种位置；所以
 * 入口做成一颗统一的浮动胶囊，右下角落位，三套皮肤下都读同一组令牌。
 */
export function ShowLauncher({ show }: { show: ShowController }) {
  if (show.phase !== "closed") return null;
  const ready = show.count > 0;

  return (
    <button
      type="button"
      className="show-launcher"
      onClick={show.open}
      aria-haspopup="dialog"
      disabled={!ready}
      title={ready ? "全屏放映，一屏一条记录" : "档案尚未载入"}
    >
      <span className="show-launcher-glyph" aria-hidden="true">
        ▶
      </span>
      <span>自动演示</span>
      {ready ? <span className="show-launcher-count">{show.count}</span> : null}
    </button>
  );
}
