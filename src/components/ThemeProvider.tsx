'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Theme as AstryxTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { readLightPalette, type LightPalette } from '@/lib/design-palettes';

type Theme = 'light' | 'dark' | 'system';
type ColorScheme = 'default' | 'wa-modern';
type UiVersion = 'legacy' | 'new';
interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  palette: LightPalette | null;
  setPalette: (palette: LightPalette) => void;
  isNewUi: boolean;
  setUiVersion: (version: UiVersion) => void;
}
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
function storePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The current page still works without storage. */ }
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>('wa-modern');
  const [palette, setPaletteState] = useState<LightPalette | null>(null);
  const [version, setVersion] = useState<UiVersion>('legacy');
  const [mounted, setMounted] = useState(false);
  const isNewUi = pathname === '/design' || (pathname !== '/' && version === 'new');

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const storedTheme = localStorage.getItem('theme');
        const scheme = localStorage.getItem('colorScheme');
        if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') setThemeState(storedTheme);
        if (scheme === 'default' || scheme === 'wa-modern') setColorSchemeState(scheme);
        setPaletteState(readLightPalette(localStorage.getItem('butuyokuoh:palette')));
        setVersion(localStorage.getItem('butuyokuoh:ui-version') === 'new' ? 'new' : 'legacy');
      } catch { /* Use defaults when browser storage is unavailable. */ }
      setMounted(true);
    });
  }, []);
  useEffect(() => {
    if (pathname !== '/design') return;
    storePreference('butuyokuoh:ui-version', 'new');
    document.cookie = `butuyokuoh-ui=new; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    queueMicrotask(() => setVersion('new'));
  }, [pathname]);
  useEffect(() => {
    if (!mounted) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'system' ? media.matches : theme === 'dark';
      document.documentElement.classList.toggle('dark', dark);
      setResolvedTheme(dark ? 'dark' : 'light');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, mounted]);
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.toggle('agenda', isNewUi);
    root.classList.toggle('wa-modern', !isNewUi && colorScheme === 'wa-modern');
    root.classList.toggle('default-scheme', !isNewUi && colorScheme === 'default');
    if (isNewUi && palette) root.dataset.lightPalette = palette;
    else delete root.dataset.lightPalette;
  }, [isNewUi, colorScheme, palette, mounted]);

  const setTheme = (value: Theme) => { setThemeState(value); storePreference('theme', value); };
  const setColorScheme = (value: ColorScheme) => { setColorSchemeState(value); storePreference('colorScheme', value); };
  const setPalette = (value: LightPalette) => { setPaletteState(value); storePreference('butuyokuoh:palette', value); };
  const setUiVersion = (value: UiVersion) => {
    setVersion(value);
    storePreference('butuyokuoh:ui-version', value);
    // A non-sensitive preference also lets the server return to the chosen home.
    document.cookie = `butuyokuoh-ui=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  return <ThemeContext.Provider value={{theme, setTheme, resolvedTheme, colorScheme, setColorScheme, palette, setPalette, isNewUi, setUiVersion}}>
    {isNewUi ? <AstryxTheme theme={neutralTheme} mode={theme}>{children}</AstryxTheme> : children}
  </ThemeContext.Provider>;
}
export function useTheme(): ThemeContextType {
  return useContext(ThemeContext) ?? {
    theme: 'system', setTheme: () => {}, resolvedTheme: 'light', colorScheme: 'wa-modern', setColorScheme: () => {},
    palette: null, setPalette: () => {}, isNewUi: false, setUiVersion: () => {},
  };
}
