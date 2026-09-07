export const env = {
  rpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
    "https://soroban-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
    "Test SDF Network ; September 2015",
  escrowContractId: process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID ?? "",
  backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080",
};
