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
  autoReleaseMilestone,
  buildMutualCancel,
  cancelEscrow,
  coSignMutualCancel,
  expireMilestone,
  finalizeMutualCancel,
  fundEscrow,
  hashFromHex,
  raiseDispute,
  resolveDispute,
  submitMilestone,
  type Resolution,
} from "@/lib/contract";
import { truncateAddress, statusLabel } from "@/lib/format";

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString();
}

function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= Date.now();
}

function autoReleaseEligible(
  submittedAt: string | null | undefined,
  reviewPeriodSeconds: number | null | undefined,
): boolean {
  if (!submittedAt || !reviewPeriodSeconds) return false;
  const eligibleAt = new Date(submittedAt).getTime() + reviewPeriodSeconds * 1000;
  return Date.now() > eligibleAt;
}

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
  const [evidenceDrafts, setEvidenceDrafts] = useState<
    Record<number, { uri: string; hash: string }>
  >({});
  const [mutualCancelBlob, setMutualCancelBlob] = useState("");
  const [mutualCancelNeeds, setMutualCancelNeeds] = useState<string[]>([]);
  const [mutualCancelPaste, setMutualCancelPaste] = useState("");
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
  const canMutuallyCancel =
    (isClient || isProvider) &&
    (escrow.status === "funded" || escrow.status === "in_progress");

  const disputeByMilestone = new Map(
    disputes.map((d) => [d.milestone_id, d]),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            Escrow #{escrow.id}
            {escrow.title ? ` — ${escrow.title}` : ""}
          </h1>
          <p className="mt-1 text-sm opacity-70">
            Client {truncateAddress(escrow.client)} · Provider{" "}
            {truncateAddress(escrow.provider)} · Arbitrator{" "}
            {truncateAddress(escrow.arbitrator)}
          </p>
          <p className="mt-1 text-xs opacity-60">
            {escrow.review_period != null && escrow.review_period > 0 && (
              <>
                Review period: {(escrow.review_period / 86_400).toFixed(1)}{" "}
                day(s)
              </>
            )}
            {escrow.metadata_uri && (
              <>
                {" · "}
                <a
                  href={escrow.metadata_uri}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Description
                </a>
                {escrow.metadata_hash ? ` (${escrow.metadata_hash})` : ""}
              </>
            )}
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
          const evidenceDraft = evidenceDrafts[m.milestone_id] ?? {
            uri: "",
            hash: "",
          };
          const deadlinePassed = isPast(m.deadline);
          const canAutoRelease =
            m.status === "submitted" &&
            autoReleaseEligible(m.submitted_at, escrow.review_period);
          return (
            <div
              key={m.milestone_id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{m.description}</p>
                <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium dark:bg-white/10">
                  {statusLabel(m.status)}
                  {m.released_via === "auto_release" && " (auto)"}
                </span>
              </div>
              <p className="mt-1 text-sm opacity-70">
                Amount: {m.amount} (atomic units)
              </p>
              {m.deadline && (
                <p className="mt-1 text-xs opacity-60">
                  Deadline: {formatDate(m.deadline)}
                  {deadlinePassed && m.status === "pending" && " — passed"}
                </p>
              )}
              {m.evidence_uri && (
                <p className="mt-1 text-xs opacity-60">
                  Evidence:{" "}
                  <a
                    href={m.evidence_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {m.evidence_uri}
                  </a>{" "}
                  ({m.evidence_hash})
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {isProvider && m.status === "pending" && (
                  <details className="w-full">
                    <summary className="cursor-pointer text-xs font-medium opacity-70 hover:opacity-100">
                      Submit Milestone
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                      <input
                        value={evidenceDraft.uri}
                        onChange={(e) =>
                          setEvidenceDrafts((prev) => ({
                            ...prev,
                            [m.milestone_id]: {
                              ...evidenceDraft,
                              uri: e.target.value,
                            },
                          }))
                        }
                        placeholder="Evidence URI (ipfs://... or https://...)"
                        className="rounded-md border border-black/15 px-2 py-1 text-xs dark:border-white/15 dark:bg-transparent"
                      />
                      <input
                        value={evidenceDraft.hash}
                        onChange={(e) =>
                          setEvidenceDrafts((prev) => ({
                            ...prev,
                            [m.milestone_id]: {
                              ...evidenceDraft,
                              hash: e.target.value,
                            },
                          }))
                        }
                        placeholder="Hash of that content (64 hex characters)"
                        className="rounded-md border border-black/15 px-2 py-1 font-mono text-xs dark:border-white/15 dark:bg-transparent"
                      />
                      <button
                        disabled={pending !== null}
                        onClick={() => {
                          let hash: Uint8Array;
                          try {
                            hash = hashFromHex(evidenceDraft.hash);
                          } catch (err) {
                            setActionError(
                              err instanceof Error
                                ? err.message
                                : String(err),
                            );
                            return;
                          }
                          if (!evidenceDraft.uri.trim()) {
                            setActionError("Evidence URI is required.");
                            return;
                          }
                          runAction(`${actionKey}-submit`, () =>
                            submitMilestone(
                              address!,
                              bigEscrowId,
                              m.milestone_id,
                              evidenceDraft.uri.trim(),
                              hash,
                            ),
                          );
                        }}
                        className="self-start rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                      >
                        {pending === `${actionKey}-submit`
                          ? "Submitting…"
                          : "Submit"}
                      </button>
                    </div>
                  </details>
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

                {address && m.status === "pending" && deadlinePassed && (
                  <button
                    disabled={pending !== null}
                    onClick={() =>
                      runAction(`${actionKey}-expire`, () =>
                        expireMilestone(address!, bigEscrowId, m.milestone_id),
                      )
                    }
                    className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/15"
                    title="Anyone can do this once the deadline has passed."
                  >
                    {pending === `${actionKey}-expire`
                      ? "Marking Expired…"
                      : "Mark Expired"}
                  </button>
                )}

                {address && canAutoRelease && (
                  <button
                    disabled={pending !== null}
                    onClick={() =>
                      runAction(`${actionKey}-auto-release`, () =>
                        autoReleaseMilestone(
                          address!,
                          bigEscrowId,
                          m.milestone_id,
                        ),
                      )
                    }
                    className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/15"
                    title="Anyone can do this once the review period has elapsed since submission."
                  >
                    {pending === `${actionKey}-auto-release`
                      ? "Releasing…"
                      : "Auto-Release"}
                  </button>
                )}

                {(isClient || isProvider) &&
                  (m.status === "pending" ||
                    m.status === "submitted" ||
                    m.status === "expired") && (
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

      {canMutuallyCancel && (
        <details className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <summary className="cursor-pointer text-sm font-medium opacity-70 hover:opacity-100">
            Mutual Cancellation
          </summary>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p className="text-xs opacity-60">
              Needs both the client&apos;s and the provider&apos;s signature.
              One party builds the transaction and sends the text below to
              the other (any channel — chat, email); the other party pastes
              it back in to co-sign, then sends their result back to finish.
            </p>

            <button
              disabled={pending !== null}
              onClick={() =>
                runAction("mutual-cancel-build", async () => {
                  const { json, needsSignatureFrom } =
                    await buildMutualCancel(address!, bigEscrowId);
                  setMutualCancelBlob(json);
                  setMutualCancelNeeds(needsSignatureFrom);
                })
              }
              className="self-start rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/15"
            >
              {pending === "mutual-cancel-build"
                ? "Building…"
                : "Start Mutual Cancellation"}
            </button>

            {mutualCancelBlob && (
              <div className="flex flex-col gap-1">
                <p className="text-xs opacity-60">
                  {mutualCancelNeeds.length > 0
                    ? `Still needs a signature from: ${mutualCancelNeeds
                        .map((a) => truncateAddress(a))
                        .join(", ")}`
                    : "Fully signed — ready to finalize."}
                </p>
                <textarea
                  readOnly
                  value={mutualCancelBlob}
                  rows={4}
                  className="rounded-md border border-black/15 p-2 font-mono text-xs dark:border-white/15 dark:bg-transparent"
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}

            <label className="flex flex-col gap-1">
              Paste a transaction blob (from the other party, or your own to
              finalize)
              <textarea
                value={mutualCancelPaste}
                onChange={(e) => setMutualCancelPaste(e.target.value)}
                rows={4}
                className="rounded-md border border-black/15 p-2 font-mono text-xs dark:border-white/15 dark:bg-transparent"
              />
            </label>
            <div className="flex gap-2">
              <button
                disabled={pending !== null || !mutualCancelPaste}
                onClick={() =>
                  runAction("mutual-cancel-cosign", async () => {
                    const json = await coSignMutualCancel(
                      mutualCancelPaste,
                      address!,
                    );
                    setMutualCancelBlob(json);
                  })
                }
                className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/15"
              >
                {pending === "mutual-cancel-cosign" ? "Signing…" : "Co-sign"}
              </button>
              <button
                disabled={pending !== null || !mutualCancelPaste}
                onClick={() =>
                  runAction("mutual-cancel-finalize", async () => {
                    await finalizeMutualCancel(mutualCancelPaste, address!);
                    setMutualCancelBlob("");
                    setMutualCancelPaste("");
                    setMutualCancelNeeds([]);
                  })
                }
                className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
              >
                {pending === "mutual-cancel-finalize"
                  ? "Submitting…"
                  : "Finalize & Submit"}
              </button>
            </div>
          </div>
        </details>
      )}

      <button
        onClick={() => reload()}
        className="self-start text-xs opacity-60 hover:opacity-100"
      >
        Refresh
      </button>
    </div>
  );
}
