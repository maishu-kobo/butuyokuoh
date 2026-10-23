'use client';

import { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import GuestBanner from '@/components/GuestBanner';

export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <ThemeProvider>
          <GuestBanner />
          {children}
        </ThemeProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
