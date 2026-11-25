import { AuthProvider } from '@/components/AuthProvider';
import GuestBanner from '@/components/GuestBanner';
import SiteFooter from '@/components/SiteFooter';
import { Suspense } from 'react';
import DesktopWorkspace from '@/components/design/DesktopWorkspace';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <GuestBanner />
      <Suspense fallback={children}><DesktopWorkspace>{children}</DesktopWorkspace></Suspense>
      <SiteFooter />
    </AuthProvider>
  );
}
