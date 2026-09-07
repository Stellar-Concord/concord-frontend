"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { truncateAddress } from "@/lib/format";

export function Header() {
  const { address, connecting, connect, disconnect } = useWallet();

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link href="/" className="text-base font-semibold">
            Concord
          </Link>
          <Link href="/escrows/new" className="opacity-70 hover:opacity-100">
            New Escrow
          </Link>
          <Link href="/arbitrator" className="opacity-70 hover:opacity-100">
            Arbitrator
          </Link>
        </nav>

        {address ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full bg-black/5 px-3 py-1 font-mono dark:bg-white/10">
              {truncateAddress(address)}
            </span>
            <button
              onClick={() => disconnect()}
              className="opacity-70 hover:opacity-100"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect()}
            disabled={connecting}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
