'use client';

import { createContext, useContext, useState } from 'react';

interface MobileMenuContextType {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const MobileMenuContext = createContext<MobileMenuContextType>({
  open: false,
  toggle: () => {},
  close: () => {},
});

export function MobileMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileMenuContext.Provider value={{ open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

export const useMobileMenu = () => useContext(MobileMenuContext);
