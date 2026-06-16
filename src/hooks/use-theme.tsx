import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type { ThemeConfig } from '@/lib/themes';
import { theme as appTheme } from '@/theme';

const FONT_LINK_ID = 'poof-theme-font';

// Start font loading immediately at module load (before React mounts)
// This eliminates the flash of unstyled text (FOUT)
(() => {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(FONT_LINK_ID);
  if (!existing && appTheme.font?.url) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = appTheme.font.url;
    document.head.appendChild(link);
  }
  if (appTheme.font?.family) {
    document.body.style.fontFamily = appTheme.font.family;
  }
})();

interface ThemeContextValue {
  /** The full theme config */
  themeConfig: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyColorsToRoot(colors: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

function applyFont(font: ThemeConfig['font']) {
  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = font.url;
  document.body.style.fontFamily = font.family;
}

function applyRadius(radius: string) {
  document.documentElement.style.setProperty('--radius', radius);
}

function applyThemeConfig(config: ThemeConfig) {
  applyColorsToRoot(config.colors);
  applyFont(config.font);
  applyRadius(config.radius);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolvedConfig = useMemo<ThemeConfig>(() => ({
    name: 'custom',
    description: 'App theme from src/theme.ts',
    ...appTheme,
  }), []);

  useEffect(() => {
    applyThemeConfig(resolvedConfig);
  }, [resolvedConfig]);

  const value = useMemo<ThemeContextValue>(
    () => ({ themeConfig: resolvedConfig }),
    [resolvedConfig],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
