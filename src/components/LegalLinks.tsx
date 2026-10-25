import Link from 'next/link';

export default function LegalLinks() {
  return (
    <nav aria-label="下書きの方針" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <Link href="/privacy" className="underline underline-offset-2 text-[var(--color-muted)] hover:text-[var(--color-text)]">
        プライバシーポリシー（下書き）
      </Link>
      <Link href="/terms" className="underline underline-offset-2 text-[var(--color-muted)] hover:text-[var(--color-text)]">
        利用規約（下書き）
      </Link>
    </nav>
  );
}
