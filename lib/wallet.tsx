"use client";

import { KitEventType, Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { env } from "./env";

let initialized = false;

function ensureKitInitialized() {
  if (initialized || typeof window === "undefined") return;
  StellarWalletsKit.init({
    modules: [new FreighterModule(), new AlbedoModule()],
    network:
      env.networkPassphrase === Networks.PUBLIC
        ? Networks.PUBLIC
        : Networks.TESTNET,
  });
  initialized = true;
}

type WalletContextValue = {
  address: string | undefined;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    ensureKitInitialized();
    const unsubscribe = StellarWalletsKit.on(
      KitEventType.STATE_UPDATED,
      (event) => {
        setAddress(event.payload.address);
      },
    );
    return unsubscribe;
  }, []);

  const connect = useCallback(async () => {
    ensureKitInitialized();
    setConnecting(true);
    try {
      await StellarWalletsKit.authModal();
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await StellarWalletsKit.disconnect();
  }, []);

  return (
    <WalletContext.Provider
      value={{ address, connecting, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}

/** Matches `SignTransaction` from `@stellar/stellar-sdk`'s contract module. */
export const signTransaction: typeof StellarWalletsKit.signTransaction = (
  xdr,
  opts,
) => StellarWalletsKit.signTransaction(xdr, opts);
