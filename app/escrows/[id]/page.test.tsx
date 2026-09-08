import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscrowDetail, Dispute } from "@/lib/api";

const { useWalletMock } = vi.hoisted(() => ({
  useWalletMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
}));

vi.mock("@/lib/wallet", () => ({
  useWallet: useWalletMock,
}));

vi.mock("@/lib/api", () => ({
  getEscrow: vi.fn(),
  listDisputes: vi.fn(),
}));

vi.mock("@/lib/contract", () => ({
  fundEscrow: vi.fn().mockResolvedValue(undefined),
  cancelEscrow: vi.fn().mockResolvedValue(undefined),
  submitMilestone: vi.fn().mockResolvedValue(undefined),
  approveMilestone: vi.fn().mockResolvedValue(undefined),
  raiseDispute: vi.fn().mockResolvedValue(undefined),
  resolveDispute: vi.fn().mockResolvedValue(undefined),
}));

import { getEscrow, listDisputes } from "@/lib/api";
import * as contract from "@/lib/contract";
import EscrowDetailPage from "./page";

const CLIENT = "GCLIENT";
const PROVIDER = "GPROVIDER";
const ARBITRATOR = "GARBITRATOR";

function baseEscrow(overrides: Partial<EscrowDetail> = {}): EscrowDetail {
  return {
    id: 1,
    contract_id: "CCONTRACT",
    client: CLIENT,
    provider: PROVIDER,
    arbitrator: ARBITRATOR,
    token: "CTOKEN",
    status: "created",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    updated_ledger: 1,
    milestones: [
      {
        escrow_id: 1,
        milestone_id: 0,
        description: "Design",
        amount: "100",
        status: "pending",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

async function renderPage(escrow: EscrowDetail, disputes: Dispute[] = []) {
  vi.mocked(getEscrow).mockResolvedValue(escrow);
  vi.mocked(listDisputes).mockResolvedValue(disputes);
  render(<EscrowDetailPage />);
  await waitFor(() => expect(screen.getByText(/Escrow #1/)).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EscrowDetailPage role-aware actions", () => {
  it("prompts to connect when no wallet is connected", async () => {
    useWalletMock.mockReturnValue({ address: undefined, connect: vi.fn() });
    await renderPage(baseEscrow());

    expect(
      screen.getByText("Connect Wallet to take action"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Fund Escrow")).not.toBeInTheDocument();
    expect(screen.queryByText("Submit Milestone")).not.toBeInTheDocument();
  });

  it("shows Fund/Cancel to the client on a created escrow, and nothing to others", async () => {
    useWalletMock.mockReturnValue({ address: CLIENT, connect: vi.fn() });
    await renderPage(baseEscrow({ status: "created" }));

    expect(screen.getByText("Fund Escrow")).toBeInTheDocument();
    expect(screen.getByText("Cancel Escrow")).toBeInTheDocument();
    expect(screen.queryByText("Submit Milestone")).not.toBeInTheDocument();
  });

  it("does not show Fund/Cancel to the provider", async () => {
    useWalletMock.mockReturnValue({ address: PROVIDER, connect: vi.fn() });
    await renderPage(baseEscrow({ status: "created" }));

    expect(screen.queryByText("Fund Escrow")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel Escrow")).not.toBeInTheDocument();
  });

  it("shows Submit Milestone to the provider on a pending milestone", async () => {
    useWalletMock.mockReturnValue({ address: PROVIDER, connect: vi.fn() });
    await renderPage(
      baseEscrow({
        status: "in_progress",
        milestones: [
          {
            escrow_id: 1,
            milestone_id: 0,
            description: "Design",
            amount: "100",
            status: "pending",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    expect(screen.getByText("Submit Milestone")).toBeInTheDocument();
  });

  function submittedEscrow() {
    return baseEscrow({
      status: "in_progress",
      milestones: [
        {
          escrow_id: 1,
          milestone_id: 0,
          description: "Design",
          amount: "100",
          status: "submitted",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
  }

  it("shows Approve Milestone to the client once submitted", async () => {
    useWalletMock.mockReturnValue({ address: CLIENT, connect: vi.fn() });
    await renderPage(submittedEscrow());
    expect(screen.getByText("Approve Milestone")).toBeInTheDocument();
  });

  it("does not show Approve Milestone to the provider once submitted", async () => {
    useWalletMock.mockReturnValue({ address: PROVIDER, connect: vi.fn() });
    await renderPage(submittedEscrow());
    expect(screen.queryByText("Approve Milestone")).not.toBeInTheDocument();
  });

  function disputedEscrowAndDisputes(): [EscrowDetail, Dispute[]] {
    const escrow = baseEscrow({
      status: "in_progress",
      milestones: [
        {
          escrow_id: 1,
          milestone_id: 0,
          description: "Design",
          amount: "100",
          status: "disputed",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const disputes: Dispute[] = [
      {
        escrow_id: 1,
        milestone_id: 0,
        raised_by: CLIENT,
        reason: "Not delivered",
        status: "open",
        resolution_kind: null,
        resolution_provider_bps: null,
        created_at: "2026-01-01T00:00:00Z",
        resolved_at: null,
      },
    ];
    return [escrow, disputes];
  }

  it("hides resolution controls from the client on a disputed milestone", async () => {
    useWalletMock.mockReturnValue({ address: CLIENT, connect: vi.fn() });
    const [escrow, disputes] = disputedEscrowAndDisputes();
    await renderPage(escrow, disputes);
    expect(screen.queryByText("Release to Provider")).not.toBeInTheDocument();
  });

  it("shows resolution controls to the arbitrator on a disputed milestone", async () => {
    useWalletMock.mockReturnValue({ address: ARBITRATOR, connect: vi.fn() });
    const [escrow, disputes] = disputedEscrowAndDisputes();
    await renderPage(escrow, disputes);
    expect(screen.getByText("Release to Provider")).toBeInTheDocument();
    expect(screen.getByText("Refund to Client")).toBeInTheDocument();
    expect(screen.getByText(/Not delivered/)).toBeInTheDocument();
  });

  it("calls fundEscrow with the connected address and escrow id when clicked", async () => {
    const user = userEvent.setup();
    useWalletMock.mockReturnValue({ address: CLIENT, connect: vi.fn() });
    await renderPage(baseEscrow({ status: "created" }));

    await user.click(screen.getByText("Fund Escrow"));

    expect(contract.fundEscrow).toHaveBeenCalledWith(CLIENT, 1n);
  });
});
