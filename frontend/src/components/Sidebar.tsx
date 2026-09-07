'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const Sidebar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  // Close mobile drawer whenever route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Hide sidebar on Auth pages
  if (pathname.includes('/login') || pathname.includes('/auth/callback')) {
    return null;
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_email');
    router.push('/login');
  };

  const navItems = [
    { name: 'Dashboard',  href: '/',           icon: '📊' },
    { name: 'Campaigns',  href: '/campaigns',   icon: '✉️' },
    { name: 'Analytics',  href: '/campaign-dashboard', icon: '📈' },
    { name: 'Leads',      href: '/leads',       icon: '👥' },
    { name: 'Responses',  href: '/responses',   icon: '💬' },
    { name: 'Settings',   href: '/settings',    icon: '⚙️' },
  ];

  return (
    <>
      {/* Mobile Top Navbar Header */}
      <header className="mobile-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button 
            onClick={() => setIsOpen(!isOpen)} 
            aria-label="Toggle navigation menu"
            style={{ 
              fontSize: '1.5rem', 
              padding: '0.25rem 0.5rem', 
              borderRadius: '6px', 
              border: '1px solid var(--border)',
              background: 'white',
              lineHeight: 1
            }}
          >
            {isOpen ? '✕' : '☰'}
          </button>
          <div>
            <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>U-marketer</span>
            <span style={{ fontSize: '0.7rem', display: 'block', color: 'var(--muted-foreground)' }}>AI Marketing Agent</span>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Overlay Backdrop */}
      {isOpen && (
        <div 
          className="mobile-backdrop" 
          onClick={() => setIsOpen(false)} 
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', padding: '0 0.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--primary)' }}>U-marketer</h1>
            <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>AI Marketing Agent</p>
          </div>
          <button 
            className="mobile-close-btn" 
            onClick={() => setIsOpen(false)}
            style={{ fontSize: '1.25rem', padding: '0.25rem 0.5rem', color: 'var(--muted-foreground)' }}
          >
            ✕
          </button>
        </div>
        
        <nav style={{ flex: 1 }}>
          <ul style={{ listStyle: 'none' }}>
            {navItems.map((item) => (
              <li key={item.href} style={{ marginBottom: '0.5rem' }}>
                <Link
                  href={item.href}
                  className={`btn btn-outline`}
                  onClick={() => setIsOpen(false)}
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    border: pathname === item.href ? '1px solid var(--primary)' : '1px solid transparent',
                    background: pathname === item.href ? 'var(--accent)' : 'transparent',
                    color: pathname === item.href ? 'var(--primary)' : 'var(--foreground)',
                    padding: '0.75rem 1rem',
                    gap: '0.75rem'
                  }}
                >
                  <span>{item.icon}</span>
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
          <button 
            onClick={handleLogout}
            className="btn btn-outline" 
            style={{ width: '100%', fontSize: '0.875rem', borderColor: '#fee2e2', color: '#991b1b' }}
          >
            🚪 Logout
          </button>
          <p style={{ fontSize: '0.75rem', textAlign: 'center', marginTop: '1rem', color: 'var(--muted-foreground)' }}>v1.0.0</p>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
