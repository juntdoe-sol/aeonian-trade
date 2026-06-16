import type { ViteDevServer } from 'vite';
interface BuildError {
  message: string;
}
export default function buildNotifierPlugin(options?: { callbackUrl: string }): {
  name: string;
  buildStart(): void;
  buildEnd(error: BuildError | null): void;
  configureServer(server: ViteDevServer): void;
};
export {};
