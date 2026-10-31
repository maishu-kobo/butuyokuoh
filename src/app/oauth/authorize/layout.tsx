import type { ReactNode } from 'react';

/** 同意画面だけ CSP を強制（frame-ancestors 'none' を含む） */
export const metadata = {
  robots: { index: false, follow: false },
};

export default function AuthorizeLayout({ children }: { children: ReactNode }) {
  return children;
}
