import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import GuestBanner from '@/components/GuestBanner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <GuestBanner />
        {children}
      </ThemeProvider>
    </AuthProvider>
  );
}
