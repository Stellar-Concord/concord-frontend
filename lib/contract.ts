import { contract } from "@stellar/stellar-sdk";
import { env } from "./env";
import { signTransaction } from "./wallet";

export type MilestoneStatus =
  | { tag: "Pending" }
  | { tag: "Submitted" }
  | { tag: "Released" }
  | { tag: "Disputed" }
  | { tag: "Resolved" };

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
}

export interface ContractEscrow {
  id: bigint;
  client: string;
  provider: string;
  arbitrator: string;
  token: string;
  milestones: ContractMilestone[];
  status: EscrowStatus;
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
      milestone_descriptions: string[];
      milestone_amounts: bigint[];
    },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<bigint>>;

  fund_escrow(
    args: { escrow_id: bigint },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  submit_milestone(
    args: { escrow_id: bigint; milestone_id: number },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  approve_milestone(
    args: { escrow_id: bigint; milestone_id: number },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;

  cancel_escrow(
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
    milestones: { description: string; amount: bigint }[];
  },
): Promise<bigint> {
  const client = await getClient();
  const tx = await client.initialize_escrow(
    {
      client: publicKey,
      provider: args.provider,
      arbitrator: args.arbitrator,
      token: args.token,
      milestone_descriptions: args.milestones.map((m) => m.description),
      milestone_amounts: args.milestones.map((m) => m.amount),
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
) {
  const client = await getClient();
  const tx = await client.submit_milestone(
    { escrow_id: escrowId, milestone_id: milestoneId },
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

export async function cancelEscrow(publicKey: string, escrowId: bigint) {
  const client = await getClient();
  const tx = await client.cancel_escrow(
    { escrow_id: escrowId },
    { publicKey },
  );
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
