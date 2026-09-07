'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [personalDetails, setPersonalDetails] = useState({
    fullName: 'Sir Umair',
    email: 'umair@u-marketer.ai'
  });
  const [policies, setPolicies] = useState({
    auto_reply_enabled: true,
    duplicate_prevention_enabled: true
  });
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [connectingAccount, setConnectingAccount] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  const loadData = async () => {
    try {
      setLoading(true);
      const [settingsData, accountsData] = await Promise.all([
        api.getSettings().catch(() => ({})),
        api.getConnectedAccounts().catch(() => ({ accounts: [] }))
      ]);
      setPersonalDetails({
        fullName: settingsData.full_name || 'Sir Umair',
        email: settingsData.email_user || 'umair@u-marketer.ai'
      });
      setPolicies({
        auto_reply_enabled: settingsData.auto_reply_enabled ?? true,
        duplicate_prevention_enabled: settingsData.duplicate_prevention_enabled ?? true
      });
      setAccounts(accountsData.accounts || []);
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleConnectAccount = async () => {
    try {
      setConnectingAccount(true);
      const res = await api.login();
      if (res.auth_url) {
        window.location.href = res.auth_url;
      } else {
        showToast('Could not initiate Google login.', 'error');
      }
    } catch (err: any) {
      showToast('Failed to connect Google account: ' + err.message, 'error');
    } finally {
      setConnectingAccount(false);
    }
  };

  const handleDisconnectAccount = async (email: string) => {
    if (!confirm(`Are you sure you want to disconnect ${email}?`)) return;
    try {
      await api.disconnectAccount(email);
      showToast(`Disconnected ${email} successfully.`);
      loadData();
    } catch (err: any) {
      showToast('Failed to disconnect account: ' + err.message, 'error');
    }
  };

  const handleSaveProfile = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!personalDetails.email || !emailRegex.test(personalDetails.email)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    try {
      setSaving(true);
      await api.updateSettings(personalDetails);
      showToast('Profile saved successfully!');
    } catch (err) {
      showToast('Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyStrategy = async () => {
    try {
      setSavingPolicy(true);
      await api.updateSettings(policies);
      showToast('Marketing policies applied successfully!');
    } catch (err) {
      showToast('Failed to apply marketing policies', 'error');
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          right: '2rem',
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: 'white',
          padding: '1rem 1.5rem',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          animation: 'slideIn 0.3s ease-out',
          whiteSpace: 'pre-wrap'
        }}>
          {toast.message}
        </div>
      )}
      <div style={{ marginBottom: '2rem' }}>
        <h1>Settings & Configuration</h1>
        <p>Manage your account, Multi-Account Gmail connections, and AI marketing preferences.</p>
      </div>

      <div className="grid-2col" style={{ marginBottom: '2rem' }}>
        {/* Connected Accounts Card */}
        <div className="card" style={{ gridColumn: 'span 2', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>Connected Gmail Accounts ({accounts.length})</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>Connect multiple Gmail sender accounts for multi-account round robin dispatching.</p>
            </div>
            <button
              className="btn"
              onClick={handleConnectAccount}
              disabled={connectingAccount}
              style={{ background: '#2563eb' }}
            >
              {connectingAccount ? 'Connecting...' : '➕ Connect / Add Gmail Account'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
            {loading ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>Loading connected accounts...</p>
            ) : accounts.length === 0 ? (
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', textAlign: 'center', fontSize: '0.875rem' }}>
                No connected Gmail accounts found. Click "Connect / Add Gmail Account" above to link your outreach accounts.
              </div>
            ) : (
              accounts.map((acc) => {
                const isExpired = acc.auth_status === 'expired';
                return (
                  <div key={acc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border)', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                        ✉️
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{acc.email}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                          {acc.name ? `${acc.name} • ` : ''}Last login: {acc.last_login ? new Date(acc.last_login).toLocaleDateString() : 'Active'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {isExpired ? (
                        <span style={{ padding: '0.25rem 0.6rem', background: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                          Expired (Reconnect Required)
                        </span>
                      ) : (
                        <span style={{ padding: '0.25rem 0.6rem', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                          Active & Ready
                        </span>
                      )}

                      {isExpired ? (
                        <button
                          onClick={handleConnectAccount}
                          style={{ padding: '0.35rem 0.75rem', background: '#2563eb', color: 'white', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}
                        >
                          Reconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDisconnectAccount(acc.email)}
                          style={{ padding: '0.35rem 0.75rem', background: 'white', border: '1px solid #fee2e2', color: '#ef4444', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Developer Portal Card */}
        <div className="card" style={{ gridColumn: 'span 2', borderLeft: '4px solid #6366f1', background: 'linear-gradient(to right, #f8fafc, #f1f5f9)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🔑</span>
                <h3 style={{ margin: 0, color: '#1e1b4b' }}>Developer Portal & REST API Keys</h3>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: 0 }}>
                Manage API keys, monitor usage credit meters, inspect connected inbox caps, and access cURL/Python integration code snippets.
              </p>
            </div>

            <Link
              href="/settings/developer"
              className="btn"
              style={{ background: 'linear-gradient(45deg, #6366f1, #4f46e5)', color: 'white', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <span>⚡ Access Developer Portal</span>
            </Link>
          </div>
        </div>

        {/* Personal Details */}
        <div className="card">
          <h3>Personal Details</h3>
          {loading ? (
            <p>Loading settings...</p>
          ) : (
            <>
              <div className="form-group">
                <label className="label">Full Name</label>
                <input 
                  className="input" 
                  value={personalDetails.fullName} 
                  onChange={(e) => setPersonalDetails({ ...personalDetails, fullName: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="label">Primary Notification Email</label>
                <input 
                  className="input" 
                  value={personalDetails.email} 
                  onChange={(e) => setPersonalDetails({ ...personalDetails, email: e.target.value })}
                  placeholder="name@example.com"
                />
              </div>
              <button 
                className="btn" 
                onClick={handleSaveProfile}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </>
          )}
        </div>

        {/* Connection Status */}
        <div className="card">
          <h3>System & Engine Status</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
              <div>
                <strong style={{ display: 'block', fontSize: '0.875rem' }}>Google Gemini AI Engine</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>Powered by Google Gemini (Free Tier • gemini-1.5-flash)</span>
              </div>
              <span style={{ padding: '0.25rem 0.5rem', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Active</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ display: 'block', fontSize: '0.875rem' }}>Multi-Account Router</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>Gmail OAuth2 Round Robin</span>
              </div>
              <span style={{ padding: '0.25rem 0.5rem', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Active</span>
            </div>
          </div>
        </div>

        {/* Marketing Policies */}
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <h3>Marketing Policies</h3>
          <p style={{ marginBottom: '1rem' }}>Define how your AI agent handles replies and follow-ups.</p>
          
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={policies.auto_reply_enabled} 
              onChange={(e) => setPolicies({ ...policies, auto_reply_enabled: e.target.checked })}
              style={{ marginRight: '0.75rem', width: '20px', height: '20px' }} 
            />
            <div>
              <strong>Auto-Reply to Unread Emails</strong>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>Automatically generate and send responses using AI when unread replies are found.</div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={policies.duplicate_prevention_enabled} 
              onChange={(e) => setPolicies({ ...policies, duplicate_prevention_enabled: e.target.checked })}
              style={{ marginRight: '0.75rem', width: '20px', height: '20px' }} 
            />
            <div>
              <strong>Duplicate Prevention</strong>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>Prevent adding leads with email addresses that already exist in your database.</div>
            </div>
          </label>

          <button 
            className="btn" 
            onClick={handleApplyStrategy}
            disabled={savingPolicy}
          >
            {savingPolicy ? 'Applying...' : 'Apply Strategy'}
          </button>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
