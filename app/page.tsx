"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { listEscrows, type EscrowSummary } from "@/lib/api";
import { truncateAddress, statusLabel } from "@/lib/format";

export default function Home() {
  const { address, connect } = useWallet();
  const [escrows, setEscrows] = useState<EscrowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    Promise.all([
      listEscrows({ client: address }),
      listEscrows({ provider: address }),
    ])
      .then(([asClient, asProvider]) => {
        if (cancelled) return;
        const byId = new Map<number, EscrowSummary>();
        for (const e of [...asClient, ...asProvider]) byId.set(e.id, e);
        setError(null);
        setEscrows(
          [...byId.values()].sort((a, b) => b.id - a.id),
        );
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">
          Trustless milestone escrow on Stellar
        </h1>
        <p className="max-w-md opacity-70">
          Connect your wallet to create an escrow, track ones you&apos;re
          part of, or resolve disputes as an arbitrator.
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your escrows</h1>
        <Link
          href="/escrows/new"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          New Escrow
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {escrows === null && <p className="opacity-70">Loading…</p>}
      {escrows?.length === 0 && (
        <p className="opacity-70">
          No escrows yet. Create one to get started.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {escrows?.map((escrow) => (
          <li key={escrow.id}>
            <Link
              href={`/escrows/${escrow.id}`}
              className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
            >
              <div>
                <p className="font-medium">Escrow #{escrow.id}</p>
                <p className="text-sm opacity-70">
                  {escrow.client === address
                    ? `Provider: ${truncateAddress(escrow.provider)}`
                    : `Client: ${truncateAddress(escrow.client)}`}
                </p>
              </div>
              <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium dark:bg-white/10">
                {statusLabel(escrow.status)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
