# Template provenance

Adapted from the user-provided Codex Sites 0.1.66 `sites-building/templates/vinext-starter`.

The UI catalog, hooks, utilities, Tailwind stylesheet and vendored Shadcn CSS originate from that template. The vendored CSS license is preserved beside the file. Dependencies retain their own licenses.

Qoder adaptations replace Vinext/Next server rendering and Cloudflare configuration with a Vite static build; remove D1/Drizzle, R2 and ChatGPT authentication scaffolding; set Shadcn to client rendering; and make the toast component use its system theme without a Next theme provider. The Function example reuses Qoder Sites' credential-free handler. No upstream hosting, auth or resource configuration is copied into generated projects.

## Implementation precedence

Production is the FastAPI service under `backend/`. `functions/` stays as the reference implementation that `backend/tests/fixtures/golden/*.json` are exported from, so the Python port can be diffed against it key-for-key. Features added after that port are not mirrored back:

- `ingest_sources` (source catalogue) and `collect_verdicts` (append-only trail) exist only in `backend/`. `functions/lib/sources.mjs` still reads the frozen `SOURCES` constant and records no verdicts, and `functions/lib/db.mjs` does not know either table.
- The console pages `#/library` and `#/sources` talk to the FastAPI admin API only; the JS handler exposes no equivalent.

A change to the four mirrored modules (`sources`, `normalize`, `cluster`, `editorial`) still has to land on both sides and re-export the golden fixtures. Everything else stops at `backend/`.
