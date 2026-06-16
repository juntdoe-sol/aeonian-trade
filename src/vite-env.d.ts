/// <reference types="vite/client" />

interface Window {
  phantom?: {
    solana?: {
      isConnected: boolean;
      publicKey?: {
        toString(): string;
      };
    };
  };
}
