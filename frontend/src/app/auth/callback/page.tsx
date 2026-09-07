'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [statusMessage, setStatusMessage] = useState('Authenticating...');
  const exchangeAttemptedRef = useRef(false);

  useEffect(() => {
    // 1. Check for error returned by OAuth provider
    const errorParam = searchParams.get('error') || searchParams.get('error_description');
    if (errorParam) {
      router.push(`/login?error=${encodeURIComponent(errorParam)}`);
      return;
    }

    // 2. Direct token in URL (redirected from backend callback)
    const token = searchParams.get('token');
    const email = searchParams.get('email');

    if (token) {
      if (exchangeAttemptedRef.current) return;
      exchangeAttemptedRef.current = true;
      localStorage.setItem('auth_token', token);
      if (email) localStorage.setItem('user_email', email);
      router.push('/');
      return;
    }

    // 3. Authorization code in URL (redirected from OAuth provider)
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (code) {
      // Guard against duplicate execution from React Strict Mode or remounts
      const sessionKey = `oauth_consumed_${code}`;
      if (exchangeAttemptedRef.current || sessionStorage.getItem(sessionKey)) {
        return;
      }
      exchangeAttemptedRef.current = true;
      sessionStorage.setItem(sessionKey, 'in_progress');

      setStatusMessage('Completing secure login...');

      api.exchangeAuthCode(code, state)
        .then((data) => {
          sessionStorage.setItem(sessionKey, 'completed');
          if (data?.token) {
            localStorage.setItem('auth_token', data.token);
            if (data.email) localStorage.setItem('user_email', data.email);
            router.push('/');
          } else {
            throw new Error('No authorization token received');
          }
        })
        .catch((err: any) => {
          sessionStorage.removeItem(sessionKey);
          console.error('[Auth Callback] Exchange failed:', err);
          const msg = err?.message || 'Token exchange failed';
          router.push(`/login?error=${encodeURIComponent(msg)}`);
        });
      return;
    }

    // If neither token nor code is present
    if (!token && !code) {
      router.push('/login?error=auth_failed');
    }
  }, [router, searchParams]);

  return (
    <div style={{ textAlign: 'center' }}>
      <h2>{statusMessage}</h2>
      <p>Please wait while we complete the secure login process.</p>
      <div className="spinner"></div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Suspense fallback={
        <div style={{ textAlign: 'center' }}>
          <h2>Loading...</h2>
        </div>
      }>
        <AuthCallbackContent />
      </Suspense>
    </div>
  );
}

