'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function DeveloperPortalPage() {
  const [user, setUser] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Key creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);

  // One-time reveal modal state
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Active snippet tab
  const [snippetTab, setSnippetTab] = useState<'curl' | 'python' | 'javascript'>('curl');

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  const loadData = async () => {
    try {
      setLoading(true);
      const [userData, accountsData, keysData] = await Promise.all([
        api.getMe().catch(() => null),
        api.getConnectedAccounts().catch(() => ({ accounts: [] })),
        api.getApiKeys().catch(() => ({ api_keys: [] }))
      ]);
      setUser(userData);
      setAccounts(accountsData.accounts || []);
      setApiKeys(keysData.api_keys || []);
    } catch (err) {
      console.error("Failed to load developer data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      showToast('Please provide a descriptive name for your API key.', 'error');
      return;
    }

    try {
      setCreatingKey(true);
      const res = await api.createApiKey(keyName.trim());
      setRevealedKey(res.api_key);
      setShowCreateModal(false);
      setKeyName('');
      loadData();
      showToast('API key generated successfully!');
    } catch (err: any) {
      showToast(err.message || 'Failed to generate API key', 'error');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke the API key "${name}"? Any integrations using this key will immediately lose access.`)) return;
    try {
      await api.deleteApiKey(keyId);
      showToast(`Revoked key "${name}".`);
      loadData();
    } catch (err: any) {
      showToast('Failed to revoke API key: ' + err.message, 'error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const sampleKey = apiKeys.length > 0 ? apiKeys[0].prefix : 'sk_live_abcdef1234567890';

  const snippets = {
    curl: `curl -X POST "http://localhost:8000/emails/generate-content" \\
  -H "Authorization: Bearer ${sampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Write a friendly cold outreach email to a SaaS founder"}'`,

    python: `import requests

url = "http://localhost:8000/emails/send-bulk"
headers = {
    "Authorization": "Bearer ${sampleKey}"
}
data = {
    "emails_json": '["prospect@example.com"]',
    "subject": "Quick question about {company}",
    "body": "Hi {first_name},\\n\\nLoved your recent product update! Let\\'s chat.",
    "follow_up_delay": 1440
}

response = requests.post(url, headers=headers, data=data)
print(response.json())`,

    javascript: `const response = await fetch('http://localhost:8000/leads/', {
  method: 'POST',
  headers: {
    'X-API-Key': '${sampleKey}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Sarah Connor',
    email: 'sarah@skynet.com',
    company: 'Cyberdyne Systems'
  })
});

const data = await response.json();
console.log(data);`
  };

  return (
    <div style={{ position: 'relative', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Toast Notification */}
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
          whiteSpace: 'pre-wrap'
        }}>
          {toast.message}
        </div>
      )}

      {/* Header with Breadcrumb */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--muted-foreground)', marginBottom: '0.5rem' }}>
          <Link href="/settings" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Settings</Link>
          <span>/</span>
          <span>Developer Portal & API Metering</span>
        </div>
        <h1 style={{ fontSize: '2.25rem', margin: '0 0 0.5rem 0', background: 'linear-gradient(to right, #2563eb, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Developer Portal & API Metering
        </h1>
        <p style={{ fontSize: '1.05rem', color: 'var(--muted-foreground)' }}>
          Manage your REST API keys, monitor credit consumption, and inspect integration code snippets.
        </p>
      </div>

      {/* Usage Metering & Quotas Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Credits Balance Meter */}
        <div className="card" style={{ borderLeft: '4px solid #6366f1', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569' }}>ORGANIZATION CREDITS</span>
            <span style={{ background: '#e0e7ff', color: '#4338ca', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
              {user?.plan_tier || 'STARTER'} TIER
            </span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#1e1b4b', marginBottom: '0.25rem' }}>
            {loading ? '...' : (user?.credits_balance ?? 1000).toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: 500, color: '#64748b' }}>credits available</span>
          </div>

          {/* Progress Bar */}
          <div style={{ height: '8px', width: '100%', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', margin: '0.75rem 0' }}>
            <div style={{ 
              height: '100%', 
              width: `${Math.min(100, ((user?.credits_balance ?? 1000) / 1000) * 100)}%`, 
              background: 'linear-gradient(to right, #6366f1, #4f46e5)',
              borderRadius: '4px'
            }}></div>
          </div>

          <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
            <span>Costs: AI Gen (5 cr), Bulk Email (1 cr/email), Auto-Reply (3 cr)</span>
          </div>
        </div>

        {/* Inbox Connections Meter */}
        <div className="card" style={{ borderLeft: '4px solid #3b82f6', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569' }}>CONNECTED INBOX CAP</span>
            <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
              LIMIT: {user?.max_connected_accounts ?? 2}
            </span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#1e3a8a', marginBottom: '0.25rem' }}>
            {loading ? '...' : accounts.length} / {user?.max_connected_accounts ?? 2} <span style={{ fontSize: '1rem', fontWeight: 500, color: '#64748b' }}>Inboxes Connected</span>
          </div>

          {/* Progress Bar */}
          <div style={{ height: '8px', width: '100%', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', margin: '0.75rem 0' }}>
            <div style={{ 
              height: '100%', 
              width: `${Math.min(100, (accounts.length / (user?.max_connected_accounts ?? 2)) * 100)}%`, 
              background: accounts.length >= (user?.max_connected_accounts ?? 2) ? '#ef4444' : '#3b82f6',
              borderRadius: '4px'
            }}></div>
          </div>

          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {accounts.length >= (user?.max_connected_accounts ?? 2) ? (
              <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠️ Connection cap reached for starter plan</span>
            ) : (
              <span>{ (user?.max_connected_accounts ?? 2) - accounts.length } account connection slot(s) available</span>
            )}
          </div>
        </div>

        {/* API Keys Stats */}
        <div className="card" style={{ borderLeft: '4px solid #10b981', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569' }}>ACTIVE API KEYS</span>
            <span style={{ background: '#dcfce7', color: '#15803d', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
              REST API
            </span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#065f46', marginBottom: '0.25rem' }}>
            {loading ? '...' : apiKeys.length} <span style={{ fontSize: '1rem', fontWeight: 500, color: '#64748b' }}>active keys</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.75rem 0 0 0' }}>
            Authenticate requests using <code style={{ background: '#e2e8f0', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>Authorization: Bearer sk_live_...</code> or <code style={{ background: '#e2e8f0', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>X-API-Key</code>
          </p>
        </div>
      </div>

      {/* API Keys Table Card */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>API Keys</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: '0.25rem 0 0 0' }}>
              Secret keys allow external applications and scripts to control your email marketing agent.
            </p>
          </div>
          <button
            className="btn"
            style={{ background: 'linear-gradient(45deg, #2563eb, #3b82f6)', color: 'white' }}
            onClick={() => setShowCreateModal(true)}
          >
            ➕ Generate New API Key
          </button>
        </div>

        {loading ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>Loading API keys...</p>
        ) : apiKeys.length === 0 ? (
          <div style={{ padding: '2rem', background: '#f8fafc', borderRadius: '8px', textAlign: 'center', border: '1px dashed #cbd5e1' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔑</div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#334155' }}>No API Keys Generated</div>
            <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '400px', margin: '0.4rem auto 1rem auto' }}>
              Create an API key to programmatically trigger bulk email campaigns or import prospect leads from your backend systems.
            </p>
            <button className="btn" style={{ background: '#2563eb' }} onClick={() => setShowCreateModal(true)}>
              Generate API Key
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', background: '#f8fafc' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Key Name</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Key Prefix</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Created Date</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.key_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 600, color: '#1e293b' }}>
                      {key.name}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <code style={{ background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace', color: '#0f172a' }}>
                        {key.prefix}
                      </code>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: 'var(--muted-foreground)' }}>
                      {key.created_at ? new Date(key.created_at).toLocaleDateString() : 'N/A'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span style={{ padding: '0.2rem 0.5rem', background: '#dcfce7', color: '#15803d', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                        Active
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                      <button
                        onClick={() => handleRevokeKey(key.key_id, key.name)}
                        style={{
                          background: 'white',
                          border: '1px solid #fee2e2',
                          color: '#ef4444',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Integration Code Snippets Section */}
      <div className="card" style={{ borderLeft: '4px solid #0284c7' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>Quick Integration Code Snippets</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: '0.25rem 0 0 0' }}>
              Copy pre-formatted code snippets to integrate U-marketer API directly into your applications.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', padding: '0.25rem', borderRadius: '8px' }}>
            {(['curl', 'python', 'javascript'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSnippetTab(tab)}
                style={{
                  background: snippetTab === tab ? 'white' : 'transparent',
                  border: 'none',
                  boxShadow: snippetTab === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: snippetTab === tab ? '#0284c7' : '#64748b',
                  cursor: 'pointer',
                  textTransform: 'uppercase'
                }}
              >
                {tab === 'javascript' ? 'Node.js' : tab}
              </button>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <pre style={{
            background: '#0f172a',
            color: '#f8fafc',
            padding: '1.25rem',
            borderRadius: '8px',
            fontSize: '0.85rem',
            overflowX: 'auto',
            fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
            lineHeight: '1.5'
          }}>
            <code>{snippets[snippetTab]}</code>
          </pre>
          <button
            onClick={() => copyToClipboard(snippets[snippetTab])}
            style={{
              position: 'absolute',
              top: '0.75rem',
              right: '0.75rem',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'white',
              padding: '0.3rem 0.6rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            {copied ? '✅ Copied!' : '📋 Copy Code'}
          </button>
        </div>
      </div>

      {/* Generate API Key Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="card" style={{ maxWidth: '450px', width: '100%', background: 'white' }}>
            <h3 style={{ marginTop: 0 }}>Generate Secret API Key</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              Give your API key a descriptive name to identify where it is used.
            </p>

            <form onSubmit={handleCreateKey}>
              <div className="form-group">
                <label className="label">Key Name / Description</label>
                <input
                  className="input"
                  placeholder="Ex: Production Backend Service"
                  value={keyName}
                  onChange={e => setKeyName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{ background: '#2563eb' }}
                  disabled={creatingKey}
                >
                  {creatingKey ? 'Generating...' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-Time Key Reveal Modal */}
      {revealedKey && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '1rem'
        }}>
          <div className="card" style={{ maxWidth: '520px', width: '100%', background: 'white', borderTop: '4px solid #10b981' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🔑</span>
              <h3 style={{ margin: 0, color: '#065f46' }}>API Key Generated Successfully</h3>
            </div>

            <div style={{ background: '#f0fdf4', padding: '0.875rem 1rem', borderRadius: '8px', border: '1px solid #bbf7d0', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600, marginBottom: '0.5rem' }}>
                ⚠️ Save your API key now:
              </div>
              <div style={{ fontSize: '0.8rem', color: '#15803d' }}>
                For security reasons, this key will <strong>NEVER</strong> be displayed again. If you lose it, you will need to generate a new key.
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label className="label">Secret API Key</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="input"
                  readOnly
                  value={revealedKey}
                  style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 600, background: '#f8fafc', letterSpacing: '0.5px' }}
                />
                <button
                  className="btn"
                  style={{ background: copied ? '#10b981' : '#2563eb', whiteSpace: 'nowrap' }}
                  onClick={() => copyToClipboard(revealedKey)}
                >
                  {copied ? '✅ Copied' : '📋 Copy'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-outline"
                onClick={() => setRevealedKey(null)}
              >
                Done / I Have Saved My Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
