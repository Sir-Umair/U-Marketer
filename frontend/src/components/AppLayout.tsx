'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import AuthCheck from '@/components/AuthCheck';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/auth/callback' || pathname?.startsWith('/auth/callback?');

  return (
    <AuthCheck>
      {isAuthPage ? (
        <main>{children}</main>
      ) : (
        <div className="app-container">
          <Sidebar />
          <main className="main-content">
            <div className="main-content-inner">
              {children}
            </div>
          </main>
        </div>
      )}
    </AuthCheck>
  );
}
