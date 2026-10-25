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
