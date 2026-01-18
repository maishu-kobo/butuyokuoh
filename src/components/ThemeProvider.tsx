'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ColorScheme = 'default' | 'wa-modern';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>('wa-modern');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const storedTheme = localStorage.getItem('theme') as Theme | null;
    const storedColorScheme = localStorage.getItem('colorScheme') as ColorScheme | null;
    if (storedTheme) {
      setThemeState(storedTheme);
    }
    if (storedColorScheme) {
      setColorSchemeState(storedColorScheme);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    
    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
        setResolvedTheme('dark');
      } else {
        root.classList.remove('dark');
        setResolvedTheme('light');
      }
    };

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);
      
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(theme === 'dark');
    }
  }, [theme, mounted]);

  // カラースキームの適用
  useEffect(() => {
    if (!mounted) return;
    
    const root = document.documentElement;
    if (colorScheme === 'wa-modern') {
      root.classList.add('wa-modern');
      root.classList.remove('default-scheme');
    } else {
      root.classList.add('default-scheme');
      root.classList.remove('wa-modern');
    }
  }, [colorScheme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const setColorScheme = (newScheme: ColorScheme) => {
    setColorSchemeState(newScheme);
    localStorage.setItem('colorScheme', newScheme);
  };

  // ハイドレーション対策：マウント前は何もレンダリングしない
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, colorScheme, setColorScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    // SSR時やProvider外でのデフォルト値
    return {
      theme: 'system' as const,
      setTheme: () => {},
      resolvedTheme: 'light' as const,
      colorScheme: 'wa-modern' as const,
      setColorScheme: () => {},
    };
  }
  return context;
}
