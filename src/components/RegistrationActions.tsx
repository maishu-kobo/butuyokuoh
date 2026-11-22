'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Keep each method's action and state together, while the sheet owns its fixed footer.
export const RegistrationActionOutlet = createContext<{container:HTMLDivElement|null;active:boolean}|null>(null);

export default function RegistrationActions({children}:{children:ReactNode}) {
  const outlet=useContext(RegistrationActionOutlet);
  if (!outlet?.container) return children;
  return outlet.active ? createPortal(children,outlet.container) : null;
}
