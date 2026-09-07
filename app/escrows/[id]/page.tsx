"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import {
  getEscrow,
  listDisputes,
  type EscrowDetail,
  type Dispute,
} from "@/lib/api";
import {
  approveMilestone,
  cancelEscrow,
  fundEscrow,
  raiseDispute,
  resolveDispute,
  submitMilestone,
  type Resolution,
} from "@/lib/contract";
import { truncateAddress, statusLabel } from "@/lib/format";

export default function EscrowDetailPage() {
  const params = useParams<{ id: string }>();
  const escrowId = params.id;
  const { address, connect } = useWallet();

  const [escrow, setEscrow] = useState<EscrowDetail | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [disputeDrafts, setDisputeDrafts] = useState<Record<number, string>>(
    {},
  );
  const [splitBps, setSplitBps] = useState<Record<number, string>>({});
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEscrow(escrowId), listDisputes("all")])
      .then(([detail, allDisputes]) => {
        if (cancelled) return;
        setEscrow(detail);
        setDisputes(
          allDisputes.filter((d) => String(d.escrow_id) === escrowId),
        );
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [escrowId, refreshIndex]);

  const reload = useCallback(() => setRefreshIndex((n) => n + 1), []);

  async function runAction(key: string, action: () => Promise<unknown>) {
    setActionError(null);
    setPending(key);
    try {
      await action();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }
  if (!escrow) {
    return <p className="opacity-70">Loading…</p>;
  }

  const isClient = address === escrow.client;
  const isProvider = address === escrow.provider;
  const isArbitrator = address === escrow.arbitrator;
  const bigEscrowId = BigInt(escrow.id);

  const disputeByMilestone = new Map(
    disputes.map((d) => [d.milestone_id, d]),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Escrow #{escrow.id}</h1>
          <p className="mt-1 text-sm opacity-70">
            Client {truncateAddress(escrow.client)} · Provider{" "}
            {truncateAddress(escrow.provider)} · Arbitrator{" "}
            {truncateAddress(escrow.arbitrator)}
          </p>
        </div>
        <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium dark:bg-white/10">
          {statusLabel(escrow.status)}
        </span>
      </div>

      {!address && (
        <button
          onClick={() => connect()}
          className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Connect Wallet to take action
        </button>
      )}

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {isClient && escrow.status === "created" && (
        <div className="flex gap-2">
          <button
            disabled={pending !== null}
            onClick={() =>
              runAction("fund", () => fundEscrow(address!, bigEscrowId))
            }
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending === "fund" ? "Funding…" : "Fund Escrow"}
          </button>
          <button
            disabled={pending !== null}
            onClick={() =>
              runAction("cancel", () => cancelEscrow(address!, bigEscrowId))
            }
            className="rounded-full border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/15"
          >
            {pending === "cancel" ? "Cancelling…" : "Cancel Escrow"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium opacity-70">Milestones</h2>
        {escrow.milestones.map((m) => {
          const dispute = disputeByMilestone.get(m.milestone_id);
          const actionKey = `milestone-${m.milestone_id}`;
          return (
            <div
              key={m.milestone_id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{m.description}</p>
                <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium dark:bg-white/10">
                  {statusLabel(m.status)}
                </span>
              </div>
              <p className="mt-1 text-sm opacity-70">
                Amount: {m.amount} (atomic units)
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {isProvider && m.status === "pending" && (
                  <button
                    disabled={pending !== null}
                    onClick={() =>
                      runAction(`${actionKey}-submit`, () =>
                        submitMilestone(
                          address!,
                          bigEscrowId,
                          m.milestone_id,
                        ),
                      )
                    }
                    className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                  >
                    {pending === `${actionKey}-submit`
                      ? "Submitting…"
                      : "Submit Milestone"}
                  </button>
                )}

                {isClient && m.status === "submitted" && (
                  <button
                    disabled={pending !== null}
                    onClick={() =>
                      runAction(`${actionKey}-approve`, () =>
                        approveMilestone(
                          address!,
                          bigEscrowId,
                          m.milestone_id,
                        ),
                      )
                    }
                    className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                  >
                    {pending === `${actionKey}-approve`
                      ? "Approving…"
                      : "Approve Milestone"}
                  </button>
                )}

                {(isClient || isProvider) &&
                  (m.status === "pending" || m.status === "submitted") && (
                    <details className="w-full">
                      <summary className="cursor-pointer text-xs font-medium opacity-70 hover:opacity-100">
                        Raise dispute
                      </summary>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={disputeDrafts[m.milestone_id] ?? ""}
                          onChange={(e) =>
                            setDisputeDrafts((prev) => ({
                              ...prev,
                              [m.milestone_id]: e.target.value,
                            }))
                          }
                          placeholder="Reason"
                          className="flex-1 rounded-md border border-black/15 px-2 py-1 text-xs dark:border-white/15 dark:bg-transparent"
                        />
                        <button
                          disabled={pending !== null}
                          onClick={() =>
                            runAction(`${actionKey}-dispute`, () =>
                              raiseDispute(
                                address!,
                                bigEscrowId,
                                m.milestone_id,
                                disputeDrafts[m.milestone_id] ?? "",
                              ),
                            )
                          }
                          className="rounded-full border border-black/15 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/15"
                        >
                          {pending === `${actionKey}-dispute`
                            ? "Submitting…"
                            : "Raise Dispute"}
                        </button>
                      </div>
                    </details>
                  )}

                {isArbitrator && m.status === "disputed" && (
                  <div className="w-full rounded-md bg-black/[.03] p-3 dark:bg-white/[.05]">
                    {dispute && (
                      <p className="mb-2 text-xs opacity-70">
                        Raised by {truncateAddress(dispute.raised_by)}:{" "}
                        {dispute.reason}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        disabled={pending !== null}
                        onClick={() =>
                          runAction(`${actionKey}-resolve-release`, () =>
                            resolveDispute(
                              address!,
                              bigEscrowId,
                              m.milestone_id,
                              { tag: "ReleaseToProvider" } as Resolution,
                            ),
                          )
                        }
                        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                      >
                        Release to Provider
                      </button>
                      <button
                        disabled={pending !== null}
                        onClick={() =>
                          runAction(`${actionKey}-resolve-refund`, () =>
                            resolveDispute(
                              address!,
                              bigEscrowId,
                              m.milestone_id,
                              { tag: "RefundToClient" } as Resolution,
                            ),
                          )
                        }
                        className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/15"
                      >
                        Refund to Client
                      </button>
                      <input
                        value={splitBps[m.milestone_id] ?? ""}
                        onChange={(e) =>
                          setSplitBps((prev) => ({
                            ...prev,
                            [m.milestone_id]: e.target.value,
                          }))
                        }
                        placeholder="Provider bps (0-10000)"
                        className="w-40 rounded-md border border-black/15 px-2 py-1 text-xs dark:border-white/15 dark:bg-transparent"
                      />
                      <button
                        disabled={pending !== null}
                        onClick={() => {
                          const bps = Number(splitBps[m.milestone_id]);
                          if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
                            setActionError(
                              "Split bps must be an integer between 0 and 10000.",
                            );
                            return;
                          }
                          runAction(`${actionKey}-resolve-split`, () =>
                            resolveDispute(
                              address!,
                              bigEscrowId,
                              m.milestone_id,
                              { tag: "Split", values: [bps] } as Resolution,
                            ),
                          );
                        }}
                        className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/15"
                      >
                        Split
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => reload()}
        className="self-start text-xs opacity-60 hover:opacity-100"
      >
        Refresh
      </button>
    </div>
  );
}
