import { useCallback } from "react";
import type { TimelineItem } from "./types";
import { StandardDialog } from "./components/StandardDialog";
import { ShowLauncher } from "./components/ShowLauncher";
import { ShowOverlay } from "./components/ShowOverlay";
import { useArchive } from "./hooks/useArchive";
import { useShow } from "./hooks/useShow";
import { useTheme } from "./hooks/useTheme";
import { AuroraView } from "./views/AuroraView";
import { EditorialView } from "./views/EditorialView";
import { MuseumView } from "./views/MuseumView";

/**
 * One archive, three readings.
 *
 * The theme *is* the layout: `data-theme` is written before the first paint by
 * the inline boot script, and this shell renders the matching view, so a reader
 * whose saved choice is 博物馆 never sees a frame of the paper edition. All
 * state — filters, the open entry, the permalink, the sync snapshot — lives in
 * `useArchive`, so switching edition re-reads the same archive rather than
 * fetching or filtering a second time.
 *
 * The screening (`useShow`) sits beside it, not inside it: one queue, one
 * range, drawn over whichever edition is on screen. Leaving a slide opens the
 * entry it was showing, so a presentation ends in the archive.
 */
export default function App() {
  const archive = useArchive();
  const { theme } = useTheme();
  const show = useShow(archive.items);

  const openEntry = useCallback(
    (item: TimelineItem) => {
      show.close();
      if (archive.expandedId !== item.id) archive.toggleRow(item.id);
      requestAnimationFrame(() => {
        const element = document.getElementById(`entry-${item.slug || item.id}`);
        if (!element) return;
        element.scrollIntoView({ block: "center", behavior: "auto" });
        element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      });
    },
    [archive, show]
  );

  return (
    <>
      <a className="skip-link" href="#main">
        跳到时间轴
      </a>

      {theme === "aurora" ? (
        <AuroraView archive={archive} />
      ) : theme === "museum" ? (
        <MuseumView archive={archive} />
      ) : (
        <EditorialView archive={archive} />
      )}

      <ShowLauncher show={show} />
      <ShowOverlay show={show} onOpenEntry={openEntry} />

      <StandardDialog
        open={archive.standardOpen}
        onClose={archive.closeStandard}
        panel={archive.panel}
      />
    </>
  );
}
