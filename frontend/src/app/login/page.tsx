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

    try {
      const data = await api.login();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('Could not get Google authorization URL');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initiate Google login. Use Quick Workspace Login below.');
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
      minHeight: '100dvh',
      width: '100%',
      maxWidth: '100vw',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: 'clamp(1rem, 3vw, 1.5rem)',
      boxSizing: 'border-box',
      overflowX: 'hidden'
    }}>
      <div style={{
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center',
        padding: 'clamp(1.5rem, 5vw, 2.25rem)',
        background: 'rgba(30, 41, 59, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
        color: '#fff',
        boxSizing: 'border-box'
      }}>
        {/* App Icon */}
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.25rem',
          fontSize: '24px',
          boxShadow: '0 8px 20px rgba(59, 130, 246, 0.35)'
        }}>
          ✉️
        </div>

        {/* Title & Description */}
        <h1 style={{
          marginBottom: '0.5rem',
          fontSize: 'clamp(1.35rem, 4.5vw, 1.7rem)',
          fontWeight: '700',
          color: '#ffffff',
          letterSpacing: '-0.02em',
          lineHeight: '1.2'
        }}>
          Email Marketer AI
        </h1>
        <p style={{
          color: '#94a3b8',
          marginBottom: '1.75rem',
          fontSize: 'clamp(0.825rem, 2.5vw, 0.9rem)',
          lineHeight: '1.5',
          wordBreak: 'break-word'
        }}>
          Automated multi-account cold outreach, AI-powered follow-ups, and inbox reply monitoring.
        </p>

        {/* Error notification if any */}
        {error && (
          <div style={{
            padding: '0.75rem 0.875rem',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#fca5a5',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            fontSize: '0.825rem',
            textAlign: 'left',
            lineHeight: '1.4',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere'
          }}>
            <strong style={{ color: '#f87171' }}>Notice:</strong> {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', boxSizing: 'border-box' }}>
          {/* Primary Action: Continue with Google */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading || directLoading}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.75rem',
              height: '48px',
              background: '#ffffff',
              color: '#1e293b',
              fontWeight: '600',
              borderRadius: '10px',
              border: 'none',
              cursor: loading || directLoading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              transition: 'all 0.2s ease',
              fontSize: 'clamp(0.875rem, 2.8vw, 0.95rem)',
              boxSizing: 'border-box',
              padding: '0 1rem'
            }}
          >
            {loading ? (
              <div style={{
                width: '20px',
                height: '20px',
                border: '2px solid rgba(0, 0, 0, 0.15)',
                borderTopColor: '#1e293b',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite'
              }} />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          {/* Subtle Divider */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            margin: '0.35rem 0'
          }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
            <span style={{ fontSize: '0.725rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
              or
            </span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
          </div>

          {/* Secondary Action: Quick Workspace Login */}
          <button
            onClick={handleDirectLogin}
            disabled={loading || directLoading}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.55rem',
              height: '44px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#e2e8f0',
              fontWeight: '500',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: loading || directLoading ? 'not-allowed' : 'pointer',
              fontSize: 'clamp(0.825rem, 2.6vw, 0.885rem)',
              transition: 'all 0.2s ease',
              boxSizing: 'border-box',
              padding: '0 0.75rem'
            }}
          >
            {directLoading ? (
              <div style={{
                width: '18px',
                height: '18px',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                borderTopColor: '#ffffff',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite'
              }} />
            ) : (
              <>⚡ Quick Workspace Login</>
            )}
          </button>
        </div>

        {/* Footer info */}
        <p style={{
          marginTop: '1.75rem',
          fontSize: '0.725rem',
          color: '#64748b',
          lineHeight: '1.4'
        }}>
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
