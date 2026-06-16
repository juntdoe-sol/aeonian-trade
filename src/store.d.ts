interface AppState {
  count: number;
  increment: () => void;
  decrement: () => void;
}
export declare const useAppStore: import('zustand').UseBoundStore<
  import('zustand').StoreApi<AppState>
>;
export {};
