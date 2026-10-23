import { notFound } from 'next/navigation';
import { CaptureHydrationPicker } from './picker';

// 開発の Playwright だけが開く。本番の NODE_ENV では出さない。
export default function CaptureHydrationPage() {
  if (process.env.NODE_ENV === 'production' || process.env.CAPTURE_TEST_HOOKS !== '1') notFound();
  return <CaptureHydrationPicker />;
}
