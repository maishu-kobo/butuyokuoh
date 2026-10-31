import { AuthProvider } from '@/components/AuthProvider';
import type { ReactNode } from 'react';

export default function OAuthLayout({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
