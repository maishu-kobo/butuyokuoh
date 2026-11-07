import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import GuestBanner from '@/components/GuestBanner';
import SiteFooter from '@/components/SiteFooter';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <GuestBanner />
        {children}
        <SiteFooter />
      </ThemeProvider>
    </AuthProvider>
  );
}
