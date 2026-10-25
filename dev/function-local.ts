// Optional Deno entry point for the Function itself. It needs SUPABASE_URL,
// SUPABASE_ANON_KEY and the platform's x-instance-id header, so Node users
// should prefer `node dev/preview.mjs 8000` (recorded upstream, fake database).
import "../functions/index.ts";
