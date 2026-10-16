import type { ReactNode } from 'react';

/** Shared artwork and transparent progress panel for startup and match loading. */
export function LoadingBackdrop({ children, leaving = false }: { children: ReactNode; leaving?: boolean }) {
  return (
    <div className={`loader-screen${leaving ? ' leaving' : ''}`}>
      <div className="loader-card">
        <div className="loader-brand">ZI<span>O</span>N</div>
        {children}
      </div>
    </div>
  );
}
