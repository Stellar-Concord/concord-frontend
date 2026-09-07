"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { getEscrow, listDisputes, type Dispute, type EscrowDetail } from "@/lib/api";
import { truncateAddress } from "@/lib/format";

interface MyDispute {
  dispute: Dispute;
  escrow: EscrowDetail;
}

export default function ArbitratorPage() {
  const { address, connect } = useWallet();
  const [disputes, setDisputes] = useState<MyDispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    listDisputes("open")
      .then(async (openDisputes) => {
        const escrowIds = [...new Set(openDisputes.map((d) => d.escrow_id))];
        const escrows = await Promise.all(
          escrowIds.map((id) => getEscrow(id).catch(() => null)),
        );
        const escrowById = new Map(
          escrows
            .filter((e): e is EscrowDetail => e !== null)
            .map((e) => [e.id, e]),
        );
        return openDisputes
          .map((dispute) => {
            const escrow = escrowById.get(dispute.escrow_id);
            return escrow ? { dispute, escrow } : null;
          })
          .filter(
            (entry): entry is MyDispute =>
              entry !== null && entry.escrow.arbitrator === address,
          );
      })
      .then((mine) => {
        if (cancelled) return;
        setError(null);
        setDisputes(mine);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="opacity-70">
          Connect the wallet you were assigned as arbitrator with.
        </p>
        <button
          onClick={() => connect()}
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Open disputes</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {disputes === null && <p className="opacity-70">Loading…</p>}
      {disputes?.length === 0 && (
        <p className="opacity-70">No open disputes assigned to you.</p>
      )}

      <ul className="flex flex-col gap-3">
        {disputes?.map(({ dispute, escrow }) => {
          const milestone = escrow.milestones.find(
            (m) => m.milestone_id === dispute.milestone_id,
          );
          return (
            <li key={`${dispute.escrow_id}-${dispute.milestone_id}`}>
              <Link
                href={`/escrows/${dispute.escrow_id}`}
                className="flex flex-col gap-1 rounded-lg border border-black/10 px-4 py-3 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
              >
                <p className="font-medium">
                  Escrow #{dispute.escrow_id} · {milestone?.description ?? `Milestone ${dispute.milestone_id}`}
                </p>
                <p className="text-sm opacity-70">
                  Raised by {truncateAddress(dispute.raised_by)}:{" "}
                  {dispute.reason}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
