'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [directLoading, setDirectLoading] = useState(false);
  const [error, setError] = useState('');
  const [cachedUrl, setCachedUrl] = useState('');

  // Check URL params for error messages from OAuth callback
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      if (errorParam === 'auth_failed') {
        setError('Authentication was interrupted. Please try again or use Workspace Login.');
      } else {
        setError(decodeURIComponent(errorParam));
      }
    }
  }, [searchParams]);

  // Pre-fetch the auth URL so the redirect is instant when clicked
  useEffect(() => {
    const prefetch = async () => {
      try {
        const data = await api.login();
        if (data.auth_url) setCachedUrl(data.auth_url);
      } catch (err: any) {
        console.warn('Url prefetch info:', err?.message || err);
      }
    };
    prefetch();
  }, []);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');

    // Redirect instantly if url is cached
    if (cachedUrl) {
      window.location.href = cachedUrl;
      return;
    }

    try {
      const data = await api.login();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('Could not get Google authorization URL');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initiate Google login. Please ensure the backend is running.');
      setLoading(false);
    }
  };

  const handleDirectLogin = async () => {
    setDirectLoading(true);
    setError('');
    try {
      await api.directLogin();
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Direct login failed');
      setDirectLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '1rem'
    }}>
      <div className="card" style={{
        maxWidth: '440px',
        width: '100%',
        textAlign: 'center',
        padding: '2.5rem',
        background: 'rgba(30, 41, 59, 0.7)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        color: '#fff'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.25rem',
          fontSize: '28px'
        }}>
          ✉️
        </div>

        <h1 style={{ marginBottom: '0.5rem', fontSize: '1.75rem', fontWeight: '700', color: '#fff' }}>
          Email Marketer AI
        </h1>
        <p style={{ color: '#94a3b8', marginBottom: '2rem', fontSize: '0.925rem', lineHeight: '1.5' }}>
          Automated multi-account cold outreach, AI-powered follow-ups, and inbox reply monitoring.
        </p>

        {error && (
          <div style={{
            padding: '0.85rem 1rem',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            fontSize: '0.85rem',
            textAlign: 'left',
            lineHeight: '1.4'
          }}>
            <strong>Notice:</strong> {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Primary Google Login Button */}
          <button
            className="btn"
            onClick={handleGoogleLogin}
            disabled={loading || directLoading}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.75rem',
              height: '48px',
              background: '#fff',
              color: '#1e293b',
              fontWeight: '600',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              transition: 'all 0.2s ease'
            }}
          >
            {loading ? (
              <div style={{
                width: '20px',
                height: '20px',
                border: '2px solid rgba(0,0,0,0.2)',
                borderTopColor: '#1e293b',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite'
              }}></div>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Quick Workspace Login */}
          <button
            onClick={handleDirectLogin}
            disabled={loading || directLoading}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.6rem',
              height: '46px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#e2e8f0',
              fontWeight: '500',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              cursor: 'pointer',
              fontSize: '0.9rem',
              transition: 'background 0.2s ease'
            }}
          >
            {directLoading ? (
              <div style={{
                width: '18px',
                height: '18px',
                border: '2px solid rgba(255,255,255,0.2)',
                borderTopColor: '#fff',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite'
              }}></div>
            ) : (
              <>⚡ Quick Workspace Login</>
            )}
          </button>
        </div>

        <p style={{ marginTop: '1.75rem', fontSize: '0.75rem', color: '#64748b' }}>
          Secure OAuth 2.0 connection. Multi-account rotation enabled.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#0f172a',
        color: '#fff'
      }}>
        Loading...
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
