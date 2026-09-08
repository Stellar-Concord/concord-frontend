import { env } from "./env";

export type EscrowStatus =
  | "created"
  | "funded"
  | "in_progress"
  | "completed"
  | "cancelled";

export type MilestoneStatus =
  | "pending"
  | "submitted"
  | "released"
  | "disputed"
  | "resolved"
  | "expired";

export interface EscrowSummary {
  id: number;
  contract_id: string;
  client: string;
  provider: string;
  arbitrator: string;
  token: string;
  status: EscrowStatus;
  created_at: string;
  updated_at: string;
  updated_ledger: number;
  /** Seconds the client has, after a milestone is submitted, before it
   * becomes auto-releasable. `0` for escrows indexed before this field
   * existed. */
  review_period?: number;
  /** The escrow's on-chain creation timestamp -- distinct from `created_at`
   * above, which is when the indexer first wrote this row. */
  chain_created_at?: string | null;
  title?: string | null;
  metadata_uri?: string | null;
  /** Hex-encoded 32-byte hash of the content at `metadata_uri`. */
  metadata_hash?: string | null;
}

export interface Milestone {
  escrow_id: number;
  milestone_id: number;
  description: string;
  amount: string;
  status: MilestoneStatus;
  updated_at: string;
  deadline?: string | null;
  /** When `submit_milestone` was called. `null` until then. */
  submitted_at?: string | null;
  evidence_uri?: string | null;
  /** Hex-encoded 32-byte hash of the content at `evidence_uri`. */
  evidence_hash?: string | null;
  /** "approved" or "auto_release". `null` until the milestone is released. */
  released_via?: string | null;
}

export interface EscrowDetail extends EscrowSummary {
  milestones: Milestone[];
}

export interface Dispute {
  escrow_id: number;
  milestone_id: number;
  raised_by: string;
  reason: string;
  status: "open" | "resolved";
  resolution_kind: "release" | "refund" | "split" | null;
  resolution_provider_bps: number | null;
  created_at: string;
  resolved_at: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.backendUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function getEscrow(id: number | bigint | string) {
  return request<EscrowDetail>(`/escrows/${id}`);
}

export function listEscrows(params: {
  client?: string;
  provider?: string;
  status?: EscrowStatus;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params.client) query.set("client", params.client);
  if (params.provider) query.set("provider", params.provider);
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));
  return request<EscrowSummary[]>(`/escrows?${query.toString()}`);
}

export function listDisputes(status: "open" | "resolved" | "all" = "open") {
  return request<Dispute[]>(`/disputes?status=${status}`);
}
