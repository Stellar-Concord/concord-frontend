# concord-frontend

Reference UI for [Concord](../concord-contracts): create an escrow, act on
it as client/provider/arbitrator, and browse open disputes. Writes go
straight to the contract with a wallet-signed transaction; reads come from
[`concord-backend`](../concord-backend)'s indexed API.

Next.js 16 (App Router), TypeScript, Tailwind v4.

## Setup

```bash
nvm use              # Node 24, per .nvmrc
cp .env.local.example .env.local   # defaults already point at the current
                                     # testnet deployment + localhost:8080
npm install --legacy-peer-deps      # see "the --legacy-peer-deps flag" below
npm run dev
```

`.env.local.example` documents every variable
(`NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`,
`NEXT_PUBLIC_ESCROW_CONTRACT_ID`, `NEXT_PUBLIC_BACKEND_URL`). The contract
ID default tracks
[`../concord-contracts/DEPLOYMENTS.md`](../concord-contracts/DEPLOYMENTS.md).

### The `--legacy-peer-deps` flag

`@creit.tech/stellar-wallets-kit` pulls in optional multi-chain wallet
adapters (e.g. a Solana wallet adapter via `@hot-wallet/sdk`) whose peer
dependency graph npm's strict resolver can't untangle. It's unrelated to
this project's own code and the app runs fine regardless — `npm install`
and `npm ci` both need the flag, CI already has it wired in.

## Pages

| Route | What |
|---|---|
| `/` | Dashboard: your escrows (as client or provider), connect wallet |
| `/escrows/new` | Create an escrow: provider, arbitrator, token, milestones |
| `/escrows/[id]` | Role-aware detail page -- see below |
| `/arbitrator` | Open disputes assigned to the connected address |

The detail page shows different actions depending on who's connected:
- **Client**: Fund / Cancel (before funding), Approve each submitted
  milestone, raise a dispute
- **Provider**: Submit each pending milestone, raise a dispute
- **Arbitrator**: resolve a disputed milestone (release to provider, refund
  to client, or a basis-points split), inline on that milestone

## Architecture

```
lib/
├── env.ts        # NEXT_PUBLIC_* config, with sane defaults
├── wallet.tsx     # WalletProvider/useWallet -- wraps stellar-wallets-kit
├── contract.ts     # One function per escrow action. Builds each via
│                    # @stellar/stellar-sdk's contract.Client.from(), which
│                    # fetches the contract's spec on-chain and marshals
│                    # args/results automatically -- no generated bindings
│                    # to maintain.
├── api.ts          # Typed fetch wrapper for concord-backend's REST API
└── format.ts        # Small display helpers (address truncation, etc.)
```

Wallet connection is via
[`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
(Freighter, Albedo, and others), using its built-in connect modal.

## Testing

```bash
npm test    # vitest run
npm run lint
npm run build
```

Vitest + React Testing Library (the setup Next.js's own docs recommend;
every page here is a synchronous Client Component, so the one thing Vitest
can't handle -- async Server Components -- doesn't apply). Coverage:

- `lib/format.test.ts`, `lib/api.test.ts` -- pure-function and
  mocked-`fetch` unit tests
- `app/escrows/[id]/page.test.tsx` -- role-aware button visibility on the
  detail page (the real business logic: who can see/do what, in which
  escrow/milestone state), plus a click triggering the right `lib/contract`
  call with the right args

CI (`.github/workflows/ci.yml`) runs lint, test, and build on every push
and PR.

## Manual verification

Beyond the automated tests, this app has been driven end-to-end in a real
headless browser against a real `concord-backend` + Postgres (including
once against the real deployed testnet contract's indexed data) -- every
route render clean, the wallet-kit connect modal opens correctly, and a
hydration mismatch caused by the wallet kit's client-only style injection
was found and fixed this way. Wallet **write** actions (fund/submit/
approve/dispute/resolve) go through `stellar-wallets-kit`'s signing flow,
which needs a real browser extension and so isn't exercised by the headless
pass or the component tests above -- `lib/contract.ts` is a thin wrapper
around `@stellar/stellar-sdk`'s standard `contract.Client` simulate/sign/
submit flow, the same primitives used (and proven live on testnet) by the
Stellar CLI invocations documented in
[`../concord-contracts/DEPLOYMENTS.md`](../concord-contracts/DEPLOYMENTS.md).
