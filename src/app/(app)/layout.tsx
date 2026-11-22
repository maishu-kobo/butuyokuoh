import { AuthProvider } from '@/components/AuthProvider';
import GuestBanner from '@/components/GuestBanner';
import SiteFooter from '@/components/SiteFooter';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <GuestBanner />
      {children}
      <SiteFooter />
    </AuthProvider>
  );
}
