"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { createEscrow, emptyMetadata, hashFromHex } from "@/lib/contract";

interface MilestoneDraft {
  description: string;
  amount: string;
  /** `datetime-local` input value. */
  deadline: string;
}

function emptyMilestone(): MilestoneDraft {
  return { description: "", amount: "", deadline: "" };
}

/** `datetime-local` gives local time with no timezone; `Date` parses that as
 * local too, so this round-trips correctly. */
function deadlineToUnixSeconds(local: string): bigint {
  return BigInt(Math.floor(new Date(local).getTime() / 1000));
}

export default function NewEscrowPage() {
  const { address, connect } = useWallet();
  const router = useRouter();

  const [provider, setProvider] = useState("");
  const [arbitrator, setArbitrator] = useState("");
  const [token, setToken] = useState("");
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([
    emptyMilestone(),
  ]);
  const [reviewPeriodDays, setReviewPeriodDays] = useState("3");
  const [showMetadata, setShowMetadata] = useState(false);
  const [title, setTitle] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [metadataHash, setMetadataHash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateMilestone(index: number, patch: Partial<MilestoneDraft>) {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );
  }

  function addMilestone() {
    setMilestones((prev) => [...prev, emptyMilestone()]);
  }

  function removeMilestone(index: number) {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;
    setError(null);

    const parsedMilestones: {
      description: string;
      amount: bigint;
      deadline: bigint;
    }[] = [];
    for (const m of milestones) {
      if (!m.description.trim()) {
        setError("Every milestone needs a description.");
        return;
      }
      let amount: bigint;
      try {
        amount = BigInt(m.amount);
      } catch {
        setError(
          `Invalid amount for "${m.description}" — enter a whole number in the token's smallest unit.`,
        );
        return;
      }
      if (amount <= 0n) {
        setError(`Amount for "${m.description}" must be greater than 0.`);
        return;
      }
      if (!m.deadline) {
        setError(`Set a deadline for "${m.description}".`);
        return;
      }
      const deadline = deadlineToUnixSeconds(m.deadline);
      if (deadline <= BigInt(Math.floor(Date.now() / 1000))) {
        setError(`Deadline for "${m.description}" must be in the future.`);
        return;
      }
      parsedMilestones.push({
        description: m.description.trim(),
        amount,
        deadline,
      });
    }

    const reviewPeriodDaysNum = Number(reviewPeriodDays);
    if (!Number.isFinite(reviewPeriodDaysNum) || reviewPeriodDaysNum <= 0) {
      setError("Review period must be a positive number of days.");
      return;
    }
    const reviewPeriod = BigInt(Math.round(reviewPeriodDaysNum * 86_400));

    let metadata = emptyMetadata();
    if (showMetadata && (title.trim() || metadataUri.trim())) {
      if (metadataUri.trim() && !metadataHash.trim()) {
        setError("A metadata URI needs a hash of what's at it.");
        return;
      }
      try {
        metadata = {
          title: title.trim(),
          metadata_uri: metadataUri.trim(),
          metadata_hash: metadataHash.trim()
            ? hashFromHex(metadataHash)
            : new Uint8Array(32),
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    setSubmitting(true);
    try {
      const escrowId = await createEscrow(address, {
        provider: provider.trim(),
        arbitrator: arbitrator.trim(),
        token: token.trim(),
        milestones: parsedMilestones,
        reviewPeriod,
        metadata,
      });
      router.push(`/escrows/${escrowId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="opacity-70">Connect your wallet to create an escrow.</p>
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
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Create Escrow</h1>

      <label className="flex flex-col gap-1 text-sm">
        Provider address
        <input
          required
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="G..."
          className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Arbitrator address
        <input
          required
          value={arbitrator}
          onChange={(e) => setArbitrator(e.target.value)}
          placeholder="G..."
          className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Token contract address
        <input
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="C..."
          className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Review period (days)
        <input
          required
          inputMode="numeric"
          value={reviewPeriodDays}
          onChange={(e) => setReviewPeriodDays(e.target.value)}
          className="w-32 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
        />
        <span className="text-xs opacity-60">
          How long the client has to review a submitted milestone before the
          provider can claim it automatically.
        </span>
      </label>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Milestones</span>
          <button
            type="button"
            onClick={addMilestone}
            className="text-sm opacity-70 hover:opacity-100"
          >
            + Add milestone
          </button>
        </div>

        {milestones.map((m, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <input
              required
              value={m.description}
              onChange={(e) =>
                updateMilestone(i, { description: e.target.value })
              }
              placeholder="Description"
              className="flex-1 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
            />
            <input
              required
              inputMode="numeric"
              value={m.amount}
              onChange={(e) => updateMilestone(i, { amount: e.target.value })}
              placeholder="Amount (atomic units)"
              className="w-44 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
            />
            <input
              required
              type="datetime-local"
              value={m.deadline}
              onChange={(e) =>
                updateMilestone(i, { deadline: e.target.value })
              }
              className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
            />
            {milestones.length > 1 && (
              <button
                type="button"
                onClick={() => removeMilestone(i)}
                className="px-2 text-sm opacity-50 hover:opacity-100"
                aria-label="Remove milestone"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <p className="text-xs opacity-60">
          Amounts are in the token&apos;s smallest unit (e.g. stroops), not
          decimal notation. Deadlines are each milestone&apos;s own submission
          deadline.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowMetadata((v) => !v)}
          className="self-start text-sm opacity-70 hover:opacity-100"
        >
          {showMetadata ? "− Hide" : "+ Add"} optional description
        </button>
        {showMetadata && (
          <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
            <label className="flex flex-col gap-1 text-sm">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Website redesign"
                className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description URI
              <input
                value={metadataUri}
                onChange={(e) => setMetadataUri(e.target.value)}
                placeholder="ipfs://... or https://..."
                className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Hash of that content (hex)
              <input
                value={metadataHash}
                onChange={(e) => setMetadataHash(e.target.value)}
                placeholder="64 hex characters"
                className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
              />
            </label>
            <p className="text-xs opacity-60">
              Only a reference and its hash are stored on-chain — the content
              itself lives wherever the URI points.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create Escrow"}
      </button>
    </form>
  );
}
