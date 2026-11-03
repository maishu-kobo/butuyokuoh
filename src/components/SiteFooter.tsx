import LegalLinks from './LegalLinks';
import { OPERATOR_NAME } from '@/lib/legal';

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 dark:border-slate-700">
      <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col items-center gap-2">
        <LegalLinks />
        <p className="text-xs text-[var(--color-muted)]">
          © {new Date().getFullYear()} {OPERATOR_NAME}
        </p>
      </div>
    </footer>
  );
}
