// Buffer polyfill - DO NOT REMOVE - required for @pooflabs/web and Solana libraries
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;
window.Buffer = Buffer;

import { ClientConfig, init } from '@pooflabs/web';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import ErrorBoundary from './ErrorBoundary';

import './globals.css';
import { TAROBASE_CONFIG } from './lib/config';
import './styles/base.css';

const { appId, chain, rpcUrl, authMethod, wsApiUrl, apiUrl, authApiUrl, mockAuth, mockAddress } =
  TAROBASE_CONFIG;

(async () => {
  try {
    // Set mock auth address in sessionStorage before SDK init (if provided)
    if (mockAuth && mockAddress) {
      sessionStorage.setItem('test-user-address', mockAddress);
    }

    // Check if PRIVY_CUSTOM_APP_ID or PHANTOM_APP_ID exists in constants
    let privyCustomAppId: string | undefined;
    let phantomAppId: string | undefined;
    try {
      const constantsModule = await import('./lib/constants');
      privyCustomAppId = (constantsModule as any).PRIVY_CUSTOM_APP_ID;
      phantomAppId = (constantsModule as any).PHANTOM_APP_ID;
    } catch (e) {
      // Constants file doesn't exist or custom auth IDs don't exist
    }

    // Base configuration
    const baseConfig = {
      apiKey: '',
      wsApiUrl,
      apiUrl,
      authApiUrl,
      appId,
      authMethod,
      chain,
      skipBackendInit: true,
      mockAuth,
      ...(rpcUrl ? { rpcUrl } : {}),
    };

    let config: Partial<ClientConfig> = { ...baseConfig };

    if (config.authMethod == 'phantom' && phantomAppId == null) {
      config = {
        ...config,
        phantomConfig: {
          appId: '6b85fded-2c57-4180-a96e-33a3cf3ebf3b',
          providers: ['injected', 'deeplink'],

          enablePrivyFallback: true,
        },
      };
    }

    if (privyCustomAppId) {
      config = {
        ...config,
        privyConfig: {
          appId: privyCustomAppId,
          config: {
            appearance: {
              walletChainType: 'solana-only',
            },
          },
        },
      };
    }

    if (phantomAppId) {
      config = {
        ...config,
        phantomConfig: {
          appId: phantomAppId,
          enablePrivyFallback: false,
        },
      };
    }

    await init(config);
  } catch (err) {
    console.error('Failed to init app', err);
    throw err;
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
