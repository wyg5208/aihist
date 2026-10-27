import { StandardDialog } from "./components/StandardDialog";
import { useArchive } from "./hooks/useArchive";
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
 */
export default function App() {
  const archive = useArchive();
  const { theme } = useTheme();

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

      <StandardDialog
        open={archive.standardOpen}
        onClose={archive.closeStandard}
        panel={archive.panel}
      />
    </>
  );
}
