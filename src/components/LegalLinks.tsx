import Link from 'next/link';

export default function LegalLinks() {
  return (
    <nav aria-label="プライバシーと利用規約" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <Link href="/privacy" className="underline underline-offset-2 text-[var(--color-muted)] hover:text-[var(--color-text)]">
        プライバシーポリシー
      </Link>
      <Link href="/terms" className="underline underline-offset-2 text-[var(--color-muted)] hover:text-[var(--color-text)]">
        利用規約
      </Link>
    </nav>
  );
}
