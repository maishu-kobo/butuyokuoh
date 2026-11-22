import Image from 'next/image';
import Link from 'next/link';

export default function AgendaBrandBar() {
  return (
    <header className="agenda-brand-bar">
      <div><Link href="/" aria-label="物欲王 ホーム">
        <Image src="/icons/icon-192.png" width={36} height={36} alt="" unoptimized />
        <span>物欲王</span>
      </Link></div>
    </header>
  );
}
