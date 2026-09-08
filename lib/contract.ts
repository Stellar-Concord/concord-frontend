import { contract } from "@stellar/stellar-sdk";
import { env } from "./env";
import { signAuthEntry, signTransaction } from "./wallet";

export type MilestoneStatus =
  | { tag: "Pending" }
  | { tag: "Submitted" }
  | { tag: "Released" }
  | { tag: "Disputed" }
  | { tag: "Resolved" }
  | { tag: "Expired" };

export type EscrowStatus =
  | { tag: "Created" }
  | { tag: "Funded" }
  | { tag: "InProgress" }
  | { tag: "Completed" }
  | { tag: "Cancelled" };

export type Resolution =
  | { tag: "ReleaseToProvider" }
  | { tag: "RefundToClient" }
  | { tag: "Split"; values: [number] };

export interface ContractMilestone {
  id: number;
  description: string;
  amount: bigint;
  status: MilestoneStatus;
  deadline: bigint;
  submitted_at: bigint;
  evidence_uri: string;
  evidence_hash: Uint8Array;
}

export interface ContractEscrow {
  id: bigint;
  client: string;
  provider: string;
  arbitrator: string;
  token: string;
  milestones: ContractMilestone[];
  status: EscrowStatus;
  review_period: bigint;
  created_at: bigint;
  title: string;
  metadata_uri: string;
  metadata_hash: Uint8Array;
}

/** Matches the contract's `MilestoneInput`: what you supply per milestone
 * at creation, before it's assigned an id and a `Pending` status. */
export interface MilestoneInput {
  description: string;
  amount: bigint;
  /** Unix seconds. Must be strictly in the future. */
  deadline: bigint;
}

/** Matches the contract's `EscrowMetadata`. Leave every field empty/zeroed
 * to omit metadata entirely -- see `emptyMetadata`. */
export interface EscrowMetadata {
  title: string;
  metadata_uri: string;
  metadata_hash: Uint8Array;
}

/** No off-chain description for this escrow. */
export function emptyMetadata(): EscrowMetadata {
  return { title: "", metadata_uri: "", metadata_hash: new Uint8Array(32) };
}

/** Parses a hex string (with or without a leading "0x") into the 32-byte
 * array the contract's `BytesN<32>` fields expect. */
export function hashFromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length !== 64) {
    throw new Error(
      `expected a 32-byte (64 hex character) hash, got ${clean.length} characters`,
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Formats a 32-byte hash back to a hex string, for display. */
export function hashToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hand-typed method signatures for the concord-escrow contract, matching
 * `concord-contracts/contracts/escrow/src/lib.rs`. `env: Env` is implicit on
 * every Soroban contract function and never appears in the client-facing
 * spec, so it's omitted here.
 */
interface EscrowContractMethods {
  initialize_escrow(
    args: {
      client: string;
      provider: string;
      arbitrator: string;
      token: string;
      milestones: MilestoneInput[];
      review_period: bigint;
      metadata: EscrowMetadata;
    },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<bigint>>;

  fund_escrow(
    args: { escrow_id: bigint },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  submit_milestone(
    args: {
      escrow_id: bigint;
      milestone_id: number;
      evidence_uri: string;
      evidence_hash: Uint8Array;
    },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  approve_milestone(
    args: { escrow_id: bigint; milestone_id: number },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  /** Permissionless: eligible once the milestone's own deadline has passed
   * while still `Pending`. Anyone can call it. */
  expire_milestone(
    args: { escrow_id: bigint; milestone_id: number },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  /** Permissionless: eligible once the escrow's review period has elapsed
   * since submission without a client response. Anyone can call it. */
  auto_release_milestone(
    args: { escrow_id: bigint; milestone_id: number },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  cancel_escrow(
    args: { escrow_id: bigint },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  /** Requires both the client's and the provider's authorization -- see
   * `buildMutualCancel`/`coSignMutualCancel`/`finalizeMutualCancel` below
   * for the two-party signing flow this needs. */
  mutual_cancel_escrow(
    args: { escrow_id: bigint },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  raise_dispute(
    args: {
      escrow_id: bigint;
      milestone_id: number;
      raised_by: string;
      reason: string;
    },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  resolve_dispute(
    args: {
      escrow_id: bigint;
      milestone_id: number;
      resolution: Resolution;
    },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;
}

type EscrowClient = contract.Client & EscrowContractMethods;

let clientPromise: Promise<EscrowClient> | null = null;

/**
 * A single cached client: the contract's spec (fetched from chain on first
 * use) doesn't depend on the connected wallet, so callers pass `publicKey`/
 * `signTransaction` per method call instead of at construction time.
 */
function getClient(): Promise<EscrowClient> {
  if (!clientPromise) {
    if (!env.escrowContractId) {
      throw new Error(
        "NEXT_PUBLIC_ESCROW_CONTRACT_ID is not set — cannot talk to the escrow contract.",
      );
    }
    clientPromise = contract.Client.from<EscrowContractMethods>({
      contractId: env.escrowContractId,
      rpcUrl: env.rpcUrl,
      networkPassphrase: env.networkPassphrase,
    }) as Promise<EscrowClient>;
  }
  return clientPromise;
}

/** Signs and submits an assembled transaction, waiting for confirmation. */
async function sign<T>(
  tx: contract.AssembledTransaction<T>,
  publicKey: string,
) {
  const sent = await tx.signAndSend({
    signTransaction: (xdr, opts) =>
      signTransaction(xdr, { ...opts, address: publicKey }),
  });
  return sent.result;
}

export async function createEscrow(
  publicKey: string,
  args: {
    provider: string;
    arbitrator: string;
    token: string;
    milestones: MilestoneInput[];
    /** Seconds the client has, after a milestone is submitted, before it
     * becomes auto-releasable. */
    reviewPeriod: bigint;
    /** Omit (or pass `emptyMetadata()`) for no off-chain description. */
    metadata?: EscrowMetadata;
  },
): Promise<bigint> {
  const client = await getClient();
  const tx = await client.initialize_escrow(
    {
      client: publicKey,
      provider: args.provider,
      arbitrator: args.arbitrator,
      token: args.token,
      milestones: args.milestones,
      review_period: args.reviewPeriod,
      metadata: args.metadata ?? emptyMetadata(),
    },
    { publicKey },
  );
  return sign(tx, publicKey);
}

export async function fundEscrow(publicKey: string, escrowId: bigint) {
  const client = await getClient();
  const tx = await client.fund_escrow({ escrow_id: escrowId }, { publicKey });
  return sign(tx, publicKey);
}

export async function submitMilestone(
  publicKey: string,
  escrowId: bigint,
  milestoneId: number,
  evidenceUri: string,
  evidenceHash: Uint8Array,
) {
  const client = await getClient();
  const tx = await client.submit_milestone(
    {
      escrow_id: escrowId,
      milestone_id: milestoneId,
      evidence_uri: evidenceUri,
      evidence_hash: evidenceHash,
    },
    { publicKey },
  );
  return sign(tx, publicKey);
}

export async function approveMilestone(
  publicKey: string,
  escrowId: bigint,
  milestoneId: number,
) {
  const client = await getClient();
  const tx = await client.approve_milestone(
    { escrow_id: escrowId, milestone_id: milestoneId },
    { publicKey },
  );
  return sign(tx, publicKey);
}

/** Anyone can call this once the milestone's own deadline has passed while
 * still `Pending` -- no particular wallet is "required", but a connected
 * one still pays the fee and submits the transaction. */
export async function expireMilestone(
  publicKey: string,
  escrowId: bigint,
  milestoneId: number,
) {
  const client = await getClient();
  const tx = await client.expire_milestone(
    { escrow_id: escrowId, milestone_id: milestoneId },
    { publicKey },
  );
  return sign(tx, publicKey);
}

/** Anyone can call this once the review period has elapsed since submission
 * without the client responding -- same caveat as `expireMilestone`. */
export async function autoReleaseMilestone(
  publicKey: string,
  escrowId: bigint,
  milestoneId: number,
) {
  const client = await getClient();
  const tx = await client.auto_release_milestone(
    { escrow_id: escrowId, milestone_id: milestoneId },
    { publicKey },
  );
  return sign(tx, publicKey);
}

export async function cancelEscrow(publicKey: string, escrowId: bigint) {
  const client = await getClient();
  const tx = await client.cancel_escrow(
    { escrow_id: escrowId },
    { publicKey },
  );
  return sign(tx, publicKey);
}

/**
 * Mutual cancellation needs both the client's and the provider's
 * authorization in one transaction. Whoever calls this becomes the
 * transaction's invoker (their `publicKey` pays the fee and, at the final
 * step, signs the envelope); the other party's authorization has to be
 * collected separately, since they're not signing the envelope itself.
 *
 * The three-step flow:
 * 1. `buildMutualCancel` (either party) -- builds the transaction and
 *    returns it serialized as JSON, plus who else still needs to sign.
 *    Send that JSON to the other party through any channel you like (this
 *    library doesn't do that part).
 * 2. `coSignMutualCancel` (the other party, having received the JSON) --
 *    signs their auth entry and returns the re-serialized JSON. Send that
 *    back to whoever ran step 1.
 * 3. `finalizeMutualCancel` (back with the original caller) -- signs the
 *    transaction envelope and submits it.
 */
export async function buildMutualCancel(
  publicKey: string,
  escrowId: bigint,
): Promise<{ json: string; needsSignatureFrom: string[] }> {
  const client = await getClient();
  const tx = await client.mutual_cancel_escrow(
    { escrow_id: escrowId },
    { publicKey },
  );
  return { json: tx.toJson(), needsSignatureFrom: tx.needsNonInvokerSigningBy() };
}

/** Step 2 of mutual cancellation -- see `buildMutualCancel`. */
export async function coSignMutualCancel(
  json: string,
  signerAddress: string,
): Promise<string> {
  const client = await getClient();
  const tx = client.txFromJson<null>(json);
  await tx.signAuthEntries({
    address: signerAddress,
    signAuthEntry: (entry, opts) =>
      signAuthEntry(entry, { ...opts, address: signerAddress }),
  });
  return tx.toJson();
}

/** Step 3 of mutual cancellation -- see `buildMutualCancel`. Must be called
 * with the same `publicKey` that ran `buildMutualCancel`, since that's
 * whose account the transaction envelope is built against. */
export async function finalizeMutualCancel(
  json: string,
  publicKey: string,
): Promise<null> {
  const client = await getClient();
  const tx = client.txFromJson<null>(json);
  return sign(tx, publicKey);
}

export async function raiseDispute(
  publicKey: string,
  escrowId: bigint,
  milestoneId: number,
  reason: string,
) {
  const client = await getClient();
  const tx = await client.raise_dispute(
    {
      escrow_id: escrowId,
      milestone_id: milestoneId,
      raised_by: publicKey,
      reason,
    },
    { publicKey },
  );
  return sign(tx, publicKey);
}

export async function resolveDispute(
  publicKey: string,
  escrowId: bigint,
  milestoneId: number,
  resolution: Resolution,
) {
  const client = await getClient();
  const tx = await client.resolve_dispute(
    { escrow_id: escrowId, milestone_id: milestoneId, resolution },
    { publicKey },
  );
  return sign(tx, publicKey);
}
