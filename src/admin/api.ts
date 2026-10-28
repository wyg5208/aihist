import { requestJson } from "../api";

export { ApiError } from "../api";

/**
 * The console's entire network surface.
 *
 * Grouped by the page that consumes it rather than by HTTP verb: a page imports
 * `contentApi` and gets every call it is allowed to make. Types here mirror the
 * payloads in `backend/app/api/admin_ops.py`; when the two disagree the backend
 * is right.
 */

const BASE = "/api/v1/admin";

/**
 * SameSite=Lax already blocks cross-site form posts, but only for navigation.
 * Requiring a custom header means a cross-origin caller has to pass a preflight
 * that the API never allows.
 */
export const WRITE_HEADERS: Record<string, string> = { "X-Requested-With": "admin" };

const WRITE: RequestInit = { method: "POST", headers: WRITE_HEADERS };

const READ: RequestInit = { cache: "no-store" };

function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(`${BASE}${path}`, { ...READ, signal });
}

function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(`${BASE}${path}`, {
    ...WRITE,
    signal,
    headers: body === undefined
      ? { ...WRITE_HEADERS }
      : { ...WRITE_HEADERS, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(`${BASE}${path}`, {
    method: "PATCH",
    headers: { ...WRITE_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type Role = "owner" | "editor" | "analyst";
export type Permission = "read" | "sync" | "decide" | "manage";

export interface LoginResponse {
  ok: boolean;
  user: string;
}

export interface SessionInfo {
  ok: boolean;
  user: string;
  role: Role;
  permissions: Permission[];
}

export const sessionApi = {
  login: (user: string, password: string) =>
    post<LoginResponse>("/login", { user, password }),
  logout: () => post<{ ok: boolean }>("/logout"),
  read: (signal?: AbortSignal) => get<SessionInfo>("/session", signal),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: boolean }>("/password", { currentPassword, newPassword }),
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncTicket {
  ok: boolean;
  triggered?: boolean;
  status: string;
  runId: string | null;
  result: null;
}

export const syncApi = {
  start: (trigger: "manual" | "auto" = "manual") =>
    post<SyncTicket>(`/sync?trigger=${trigger}`),
};

// ---------------------------------------------------------------------------
// Runs and sources
// ---------------------------------------------------------------------------

export interface AdminRunRecord {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  rawCount: number;
  createdCount: number;
  mergedCount: number;
  failedSources: string[];
  notes: string | null;
  reviewedCount: number;
  admittedCount: number;
  excludedCount: number;
  heldCount: number;
  panelConfigured: boolean;
  durationMs: number;
  detail: RunDetailPayload;
}

export interface RunSourceEntry {
  key?: string;
  name?: string;
  ok?: boolean;
  ms?: number;
  items?: number;
  error?: string | null;
}

export interface RunDetailPayload {
  sources?: RunSourceEntry[];
  notes?: string[];
  [key: string]: unknown;
}

export interface SourceHealthRow {
  key: string;
  name: string;
  family: string;
  lastOkAt: string | null;
  lastError: string;
  consecutiveFailures: number;
  lastMs: number;
  lastItemCount: number;
  totalRuns: number;
  totalFailures: number;
}

export interface JudgeRow {
  judge: string;
  models: string[];
  ballots: number;
  include: number;
  exclude: number;
  includeRate: number;
  meanScore: number;
  topFlags: string[];
}

export const runsApi = {
  feed: (limit = 30, signal?: AbortSignal) =>
    get<{ ok: boolean; runs: AdminRunRecord[] }>(`/runs/feed?limit=${limit}`, signal),
  detail: (id: string, signal?: AbortSignal) =>
    get<{ ok: boolean; run: AdminRunRecord }>(`/runs/${encodeURIComponent(id)}`, signal),
  /** Unenriched list, kept for the legacy `/runs` contract. */
  legacy: (limit = 20, signal?: AbortSignal) =>
    get<{ ok: boolean; runs: AdminRunRecord[] }>(`/runs?limit=${limit}`, signal),
  sources: (signal?: AbortSignal) =>
    get<{ ok: boolean; items: SourceHealthRow[]; total: number }>("/sources", signal),
};

// ---------------------------------------------------------------------------
// Editorial review
// ---------------------------------------------------------------------------

/** One row of the hold queue, as `/holds` reports it. */
export interface HoldRow {
  id: string;
  slug: string | null;
  title: string;
  category: string;
  sortDate: string;
  sourceCount: number;
  score: number | null;
  decision: string | null;
  votes: Array<Record<string, unknown>>;
  notes: string | null;
}

export const editorialApi = {
  holds: (limit = 50, signal?: AbortSignal) =>
    get<{ ok: boolean; items: HoldRow[]; total: number }>(`/holds?limit=${limit}`, signal),
  judges: (days = 30, signal?: AbortSignal) =>
    get<{ ok: boolean; days: number; items: JudgeRow[] }>(`/judges?days=${days}`, signal),
};

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type EditorialStatusValue = "admitted" | "hold" | "excluded" | null;

export interface AdminEventRow {
  id: string;
  slug: string | null;
  title: string;
  titleEn: string | null;
  summary: string;
  category: string;
  sortDate: string;
  year: number;
  importance: number;
  confidence: string;
  sourceCount: number;
  origin: string;
  editorialStatus: EditorialStatusValue;
  opsNote: string | null;
  fingerprint: string;
  firstSeenAt: string;
  updatedAt: string;
}

export interface AdminAuditLine {
  at: string;
  actor: string;
  role: string;
  action: string;
  summary: string;
  detail: Record<string, unknown>;
}

/** One piece of evidence behind an entry; mirrors `src/types.ts::EvidenceSource`. */
export interface AdminEventSource {
  name?: string;
  family?: string;
  title?: string;
  url?: string;
  publishedAt?: string | null;
  externalId?: string;
}

export interface AdminReviewVote {
  judge?: number | string;
  model?: string;
  score?: number;
  vote?: string;
  flags?: string[];
}

export interface AdminEditorialReview {
  version?: string;
  source?: string;
  decision?: string;
  score?: number;
  includeVotes?: number;
  validVotes?: number;
  votes?: AdminReviewVote[];
  at?: string;
  reason?: string;
}

export interface AdminEventDetail extends AdminEventRow {
  sources: AdminEventSource[];
  meta: Record<string, unknown>;
  editorialReview: AdminEditorialReview | null;
  audit: AdminAuditLine[];
}

export interface ContentQuery {
  q?: string;
  category?: string;
  confidence?: string;
  status?: string;
  origin?: string;
  year?: number | string;
  /** `unslugged` | `sourceless` | `ungated` | `uncategorized` — see `data_health`. */
  missing?: string;
  sort?: string;
  page?: number;
  size?: number;
}

export type DecisionAction =
  | "admit"
  | "exclude"
  | "hold"
  | "re-review"
  | "importance"
  | "note";

export interface DecisionPayload {
  action: DecisionAction;
  reason?: string;
  importance?: number;
}

export const contentApi = {
  list: (filters: ContentQuery, signal?: AbortSignal) =>
    get<{
      ok: boolean;
      items: AdminEventRow[];
      total: number;
      page: number;
      size: number;
    }>(`/events${query({ ...filters })}`, signal),
  read: (id: string, signal?: AbortSignal) =>
    get<{ ok: boolean; event: AdminEventDetail }>(
      `/events/${encodeURIComponent(id)}`,
      signal,
    ),
  decide: (id: string, payload: DecisionPayload) =>
    post<{ ok: boolean; event: AdminEventRow; action: DecisionAction }>(
      `/events/${encodeURIComponent(id)}/decision`,
      payload,
    ),
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewAlert {
  code: string;
  level: "info" | "warn" | "danger" | string;
  message: string;
  href: string;
}

export interface OverviewGroup {
  key: string;
  count: number;
}

export interface ContentSnapshot {
  total: number;
  live: number;
  admitted: number;
  hold: number;
  excluded: number;
  legacy: number;
  recent: number;
  recentDays: number;
  byOrigin: OverviewGroup[];
  byConfidence: OverviewGroup[];
  byCategory: OverviewGroup[];
}

export interface AdmissionDay {
  day: string;
  admitted: number;
  hold: number;
  excluded: number;
  legacy: number;
}

export interface TrafficDay {
  day: string;
  pv: number;
  uv: number;
}

export interface OverviewResponse {
  ok: boolean;
  generatedAt: string;
  days: number;
  content: ContentSnapshot;
  health: {
    unslugged: number;
    sourceless: number;
    ungated: number;
    uncategorized: number;
  };
  runs: AdminRunRecord[];
  sources: SourceHealthRow[];
  admissions: AdmissionDay[];
  traffic: {
    today: { day: string; pv: number; uv: number; pvPrev: number; uvPrev: number };
    series: TrafficDay[];
  };
  subscribers: {
    byStatus: OverviewGroup[];
    total: number;
    series: Array<{ day: string; pv: number; uv: number }>;
  };
  keys: { overQuota: number; total: number };
  alerts: OverviewAlert[];
  panel: {
    configured: boolean;
    models: string[];
    reason: string | null;
    rubricVersion: string;
    includeScore: number;
    minVotes: number;
  };
  viewer: { user: string; role: Role; permissions: Permission[] };
}

export const overviewApi = {
  read: (days = 7, signal?: AbortSignal) =>
    get<OverviewResponse>(`/overview?days=${days}`, signal),
};

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export interface TrafficResponse {
  ok: boolean;
  days: number;
  beacon: {
    enabled: boolean;
    series: TrafficDay[];
    breakdown: {
      channel: OverviewGroup[];
      pageKind: OverviewGroup[];
      device: OverviewGroup[];
      uaFamily: OverviewGroup[];
    };
    topPaths: Array<{ path: string; views: number; visitors: number }>;
  };
  crawl: {
    configured: boolean;
    logPath: string;
    hits: number;
    aiHits: number;
    byBot: OverviewGroup[];
    topPaths: Array<{ path: string; hits: number }>;
    series: Array<{ day: string; count: number; uv: number }>;
  };
  note: string;
}

export const trafficApi = {
  read: (days = 30, signal?: AbortSignal) =>
    get<TrafficResponse>(`/traffic?days=${days}`, signal),
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  detail: Record<string, unknown>;
  ipHash: string;
}

export interface AuditQuery {
  action?: string;
  actor?: string;
  targetType?: string;
  targetId?: string;
  q?: string;
  page?: number;
  size?: number;
}

export const auditApi = {
  list: (filters: AuditQuery, signal?: AbortSignal) =>
    get<{ ok: boolean; items: AuditEntry[]; total: number; page: number; size: number }>(
      `/audit${query({ ...filters })}`,
      signal,
    ),
};

// ---------------------------------------------------------------------------
// Growth and commercial — filled in with B3/B4; typed here so pages compile
// ---------------------------------------------------------------------------

export interface SubscriberRow {
  id: string;
  email: string;
  status: string;
  sourcePath: string | null;
  sourceChannel: string | null;
  consentedAt: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  scopes: string[];
  monthlyQuota: number;
  monthRequests: number;
  monthErrors: number;
  createdBy: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface PartnerRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  code: string | null;
  targetUrl: string | null;
  contact: string;
  termsNote: string;
  startsOn: string | null;
  endsOn: string | null;
  clicks: number;
}

/** What `POST /partners` and `PATCH /partners/{id}` accept. */
export interface PartnerWrite {
  name?: string;
  kind?: string;
  status?: string;
  code?: string;
  targetUrl?: string | null;
  contact?: string;
  termsNote?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
}

export interface KeyUsagePoint {
  day: string;
  count: number;
  errors: number;
}

export interface SettingsEntry {
  key: string;
  label: string;
  value: string;
  detail: string;
  level: "ok" | "warn" | "danger";
}

export interface AdminUserRow {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
}

export const growthApi = {
  subscribers: (
    filters: { status?: string; q?: string; page?: number; size?: number },
    signal?: AbortSignal,
  ) =>
    get<{
      ok: boolean;
      items: SubscriberRow[];
      total: number;
      page: number;
      size: number;
      /** Per-status totals for the tabs; `repo_growth.count_by_status`. */
      counts: Record<string, number>;
    }>(`/subscribers${query({ ...filters })}`, signal),
  setSubscriberStatus: (id: string, status: string, note: string) =>
    post<{ ok: boolean; subscriber: SubscriberRow }>(
      `/subscribers/${encodeURIComponent(id)}/status`,
      { status, note },
    ),
  /** A plain navigation target: the response is a download, not JSON. */
  exportUrl: (status?: string) => `${BASE}/subscribers/export.csv${query({ status })}`,
};

export const keysApi = {
  list: (signal?: AbortSignal) =>
    get<{
      ok: boolean;
      items: ApiKeyRow[];
      overQuota: number;
      /** `YYYY-MM-01`: the window `monthRequests` counts inside. */
      monthStart: string;
    }>("/keys", signal),
  usage: (days = 30, signal?: AbortSignal) =>
    get<{ ok: boolean; days: number; series: KeyUsagePoint[] }>(`/keys/usage?days=${days}`, signal),
  /** The only response that ever contains a plaintext key. */
  create: (body: { name: string; monthlyQuota?: number; scopes?: string[] }) =>
    post<{ ok: boolean; key: ApiKeyRow; plaintext: string }>("/keys", body),
  revoke: (id: string) =>
    post<{ ok: boolean; key: ApiKeyRow }>(`/keys/${encodeURIComponent(id)}/revoke`),
};

export const partnersApi = {
  list: (days = 30, signal?: AbortSignal) =>
    get<{ ok: boolean; items: PartnerRow[]; days: number }>(`/partners/stats?days=${days}`, signal),
  create: (body: PartnerWrite) =>
    post<{ ok: boolean; partner: PartnerRow }>("/partners", body),
  update: (id: string, body: PartnerWrite) =>
    patch<{ ok: boolean; partner: PartnerRow }>(`/partners/${encodeURIComponent(id)}`, body),
};

/** One public application, as `GET /applications` reports it. */
export interface ApplicationRow {
  id: string;
  email: string;
  name: string;
  /** Free text from a stranger: render as text, never as markup. */
  purpose: string;
  siteUrl: string;
  status: "pending" | "approved" | "rejected" | string;
  note: string;
  monthlyQuota: number;
  keyId: string | null;
  createdAt: string | null;
  decidedAt: string | null;
  decidedBy: string;
}

/** `plaintext` and `email` are present on approve only. */
export interface ApplicationDecision {
  ok: boolean;
  application: ApplicationRow;
  key?: ApiKeyRow;
  plaintext?: string;
  email?: { configured: boolean; sent: boolean; error: string | null };
}

export const applicationsApi = {
  list: (
    filters: { status?: string; page?: number; size?: number },
    signal?: AbortSignal,
  ) =>
    get<{
      ok: boolean;
      applications: ApplicationRow[];
      total: number;
      page: number;
      size: number;
      /** Per-status totals for the filter, computed before pagination. */
      counts: Record<string, number>;
    }>(`/applications${query({ ...filters })}`, signal),
  /** Issues a key and mails it. The response is the only place the key exists. */
  approve: (id: string, body: { monthlyQuota?: number; note?: string }) =>
    post<ApplicationDecision>(`/applications/${encodeURIComponent(id)}/approve`, body),
  reject: (id: string, body: { note: string }) =>
    post<ApplicationDecision>(`/applications/${encodeURIComponent(id)}/reject`, body),
};

export const usersApi = {
  list: (signal?: AbortSignal) =>
    get<{ ok: boolean; items: AdminUserRow[] }>("/users", signal),
  create: (body: { username: string; password: string; role: Role }) =>
    post<{ ok: boolean; user: AdminUserRow }>("/users", body),
  update: (id: string, body: { role?: Role; active?: boolean }) =>
    patch<{ ok: boolean; user: AdminUserRow }>(`/users/${encodeURIComponent(id)}`, body),
  resetPassword: (id: string, password: string) =>
    post<{ ok: boolean }>(`/users/${encodeURIComponent(id)}/password`, { password }),
};

export const settingsApi = {
  read: (signal?: AbortSignal) =>
    get<{ ok: boolean; settings: SettingsEntry[] }>("/settings", signal),
};

// ---------------------------------------------------------------------------
// Collection library
// ---------------------------------------------------------------------------

/** One `raw_items` row as the audit surface reports it. */
export interface LibraryItem {
  id: string;
  sourceKey: string;
  sourceName: string;
  sourceFamily: string;
  externalId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  fetchedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  seenCount: number;
  /** `pending` | `admitted` | `excluded` | `held` | `dropped` */
  status: string;
  /** `fetch` | `normalize` | `cap` | `cluster` | `rule` | `panel` | `manual` */
  stage: string;
  reasonCode: string;
  /** Chinese label resolved by the backend from `app/ingest/reasons.py`. */
  reasonLabel: string;
  reasonText: string;
  score: number;
  decidedAt: string | null;
  eventFingerprint: string | null;
  eventId: string | null;
  eventSlug: string | null;
  eventTitle: string | null;
  runId: string | null;
}

export interface LibraryVerdict {
  id: string;
  at: string | null;
  runId: string | null;
  stage: string;
  status: string;
  reasonCode: string;
  reasonLabel: string;
  reasonText: string;
  score: number;
  eventFingerprint: string | null;
}

/** The panel ballot behind a decision; mirrors `AdminEditorialReview` plus rubric. */
export interface LibraryReview {
  rubricVersion: string;
  decision: string;
  score: number;
  includeVotes: number;
  validVotes: number;
  sourceCount: number;
  decisionSource: string;
  votes: AdminReviewVote[];
  at: string | null;
}

export interface LibraryDetail {
  ok: boolean;
  item: LibraryItem;
  verdicts: LibraryVerdict[];
  review: LibraryReview | null;
  event: {
    id: string;
    slug: string | null;
    title: string;
    category: string;
    editorialStatus: EditorialStatusValue;
    eventDate: string;
  } | null;
}

export interface LibrarySummary {
  days: number;
  total: number;
  byStatus: Record<string, number>;
  byStage: Record<string, number>;
  byReason: Record<string, number>;
  bySource: Record<string, number>;
}

export interface LibraryFunnelStage {
  stage: string;
  admitted: number;
  excluded: number;
  held: number;
  dropped: number;
  pending: number;
}

export interface LibraryReasonOption {
  code: string;
  label: string;
  stage: string;
  count: number;
}

export interface LibraryFunnel {
  ok: boolean;
  days: number;
  /** The last run's own counters, straight out of `sync_runs.detail.funnel`. */
  latest: {
    runId: string | null;
    startedAt: string | null;
    funnel: Record<string, number | Record<string, number>>;
    verdicts: Record<string, number>;
  };
  stages: LibraryFunnelStage[];
  verdicts: LibraryReasonOption[];
  bySource: Array<{
    key: string;
    name: string;
    family: string;
    admitted: number;
    excluded: number;
    held: number;
    dropped: number;
    pending: number;
    total: number;
  }>;
}

export interface LibraryQuery {
  q?: string;
  status?: string;
  stage?: string;
  /** A code or a prefix (`rule:`, `panel:`); the backend matches prefixes. */
  reason?: string;
  sourceKey?: string;
  family?: string;
  runId?: string;
  days?: number;
  page?: number;
  size?: number;
  sort?: string;
}

export const libraryApi = {
  list: (filters: LibraryQuery, signal?: AbortSignal) =>
    get<{
      ok: boolean;
      items: LibraryItem[];
      total: number;
      page: number;
      size: number;
      summary: LibrarySummary;
    }>(`/library${query({ ...filters })}`, signal),
  funnel: (days = 7, signal?: AbortSignal) =>
    get<LibraryFunnel>(`/library/funnel?days=${days}`, signal),
  reasons: (days = 30, signal?: AbortSignal) =>
    get<{ ok: boolean; items: LibraryReasonOption[] }>(`/library/reasons?days=${days}`, signal),
  detail: (id: string, signal?: AbortSignal) =>
    get<LibraryDetail>(`/library/${encodeURIComponent(id)}`, signal),
};

// ---------------------------------------------------------------------------
// Source catalogue (mutable configuration, unlike `/sources`)
// ---------------------------------------------------------------------------

export interface SourceRegistryRow {
  key: string;
  name: string;
  family: string;
  kind: string;
  url: string;
  enabled: boolean;
  rationale: string;
  verifiedAt: string | null;
  domestic: boolean;
  aiOnly: boolean;
  lastOkAt: string | null;
  lastError: string;
  consecutiveFailures: number;
  lastMs: number;
  lastItemCount: number;
  totalRuns: number;
  totalFailures: number;
}

export interface ProbeResult {
  ok: boolean;
  status: number | null;
  ms: number;
  attempts: number;
  error: string | null;
  sample: Array<{ title: string; url: string; publishedAt: string | null }>;
  latestAt: string | null;
  itemCount: number;
  url: string;
  kind: string;
}

export interface SourceWrite {
  key?: string;
  name?: string;
  family?: string;
  kind?: string;
  url?: string;
  pathPattern?: string;
  domestic?: boolean;
  aiOnly?: boolean;
  timeoutMs?: number;
  rationale?: string;
}

export const sourcesApi = {
  registry: (signal?: AbortSignal) =>
    get<{
      ok: boolean;
      items: SourceRegistryRow[];
      total: number;
      enabled: number;
      unverified: number;
      families: Array<{ key: string; label: string; count: number }>;
      kinds: string[];
    }>("/sources/registry", signal),
  /** Dry run: never writes, and the only call that fetches an arbitrary URL. */
  probe: (body: { url: string; kind: string; pathPattern?: string; timeoutMs?: number }) =>
    post<{ ok: boolean; probe: ProbeResult }>("/sources/probe", body),
  verify: (key: string) =>
    post<{ ok: boolean; probe: ProbeResult; source: SourceRegistryRow }>(
      `/sources/registry/${encodeURIComponent(key)}/verify`,
    ),
  create: (body: SourceWrite & { key: string; url: string }) =>
    post<{ ok: boolean; source: SourceRegistryRow }>("/sources/registry", body),
  update: (key: string, body: SourceWrite) =>
    patch<{ ok: boolean; source: SourceRegistryRow; probeRequired: boolean }>(
      `/sources/registry/${encodeURIComponent(key)}`,
      body,
    ),
  setEnabled: (key: string, enabled: boolean) =>
    post<{ ok: boolean; source: SourceRegistryRow }>(
      `/sources/registry/${encodeURIComponent(key)}/enabled`,
      { enabled },
    ),
};
