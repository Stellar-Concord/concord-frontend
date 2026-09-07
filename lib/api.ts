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
  | "resolved";

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
}

export interface Milestone {
  escrow_id: number;
  milestone_id: number;
  description: string;
  amount: string;
  status: MilestoneStatus;
  updated_at: string;
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
