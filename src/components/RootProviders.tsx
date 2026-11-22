'use client';

import { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from './ThemeProvider';

export function RootProviders({ children }: { children: ReactNode }) {
  return <SessionProvider><ThemeProvider>{children}</ThemeProvider></SessionProvider>;
}
