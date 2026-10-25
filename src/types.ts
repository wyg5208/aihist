export type Category = "milestone" | "model" | "research" | "opinion" | "policy";
export type Confidence = "verified" | "likely" | "single";
export type DatePrecision = "year" | "month" | "day";
export type EditorialStatus = "admitted" | "excluded" | "hold";

export interface SyncSummary {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: string | null;
  running: boolean;
  stale: boolean;
  seedVersion: string | null;
  eventCount?: number;
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface TimelineItem {
  id: string;
  slug: string | null;
  eventDate: string;
  datePrecision: DatePrecision;
  sortDate: string;
  year: number;
  title: string;
  titleEn: string | null;
  category: Category;
  organization: string | null;
  modelName: string | null;
  vendor?: string | null;
  series?: string | null;
  importance: number;
  confidence: Confidence;
  sourceCount: number;
  sourceFamilies: string[];
  tags: string[];
  origin: string;
  editorialStatus: EditorialStatus | null;
  firstSeenAt: string;
  updatedAt: string;
}

export interface TimelineResponse {
  ok: true;
  items: TimelineItem[];
  total: number;
  truncated: boolean;
  sync: SyncSummary;
}

export interface EvidenceSource {
  name: string;
  family: string;
  title: string;
  url: string;
  publishedAt: string | null;
  externalId?: string;
}

export interface EditorialVote {
  judge: number | string;
  model: string;
  score: number;
  vote: "include" | "exclude";
  flags?: string[];
  reason?: string;
}

export interface EditorialReview {
  version: string;
  source: string;
  decision: "include" | "exclude" | "hold";
  score: number;
  includeVotes: number;
  validVotes: number;
  votes: EditorialVote[];
  at: string;
}

export interface EventDetail extends TimelineItem {
  fingerprint: string;
  summary: string;
  summaryKind: "curated" | "generated" | "excerpt" | "template" | string;
  sources: EvidenceSource[];
  meta: Record<string, unknown>;
  editorialReview: EditorialReview | null;
}

export interface EventResponse {
  ok: true;
  event: EventDetail;
}

export interface RunRecord {
  id: string;
  trigger: "auto" | "manual" | string;
  status: "running" | "succeeded" | "partial" | "failed" | string;
  startedAt: string;
  finishedAt: string | null;
  rawCount: number;
  createdCount: number;
  mergedCount: number;
  failedSources: string[];
  notes: string | null;
}

export interface PanelInfo {
  configured: boolean;
  models: string[];
  reason: string | null;
  rubricVersion: string;
  includeScore: number;
  minVotes: number;
}

export interface StatusResponse {
  ok: true;
  sync: SyncSummary & { eventCount: number };
  panel: PanelInfo;
  runs: RunRecord[];
}

export interface SyncResult {
  status: string;
  seedInserted?: number;
  rawCount: number;
  createdCount: number;
  mergedCount: number;
  reviewedCount?: number;
  admittedCount?: number;
  excludedCount?: number;
  heldCount?: number;
  panelConfigured?: boolean;
  failedSources: string[];
  notes: string | null;
}

export interface StandardGate {
  title: string;
  detail: string;
}

export interface StandardDimension {
  name: string;
  weight: number;
  detail: string;
}

export interface Standard {
  version: string;
  includeScore: number;
  panelSize: number;
  minVotes: number;
  principle: string;
  gates: StandardGate[];
  dimensions: StandardDimension[];
  hardRejects: { key: string; label: string }[];
  panel: { size: number; minVotes: number; temperature: number; detail: string };
  decisions: { include: string; exclude: string; hold: string };
}

export interface StandardResponse {
  ok: true;
  standard: Standard;
}

export interface SyncResponse {
  ok: boolean;
  triggered?: boolean;
  status: string;
  runId: string | null;
  result: SyncResult | null;
}
