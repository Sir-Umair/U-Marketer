'use client';

import React, { useEffect, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Response {
  id: string;
  name?: string;
  email: string;
  subject: string;
  intent: string;
  message: string;
  ai_reply: string;
  reply_sent: boolean;
  timestamp: string;
  thread_id?: string;
}

interface LeadResponse {
  email: string;
  replied: boolean;
  response: Response | null;
}

interface CampaignDashboard {
  id: string;
  subject: string;
  timestamp: string;
  leads: LeadResponse[];
}

const INTENT_COLORS: Record<string, { bg: string; color: string }> = {
  interest:    { bg: '#dcfce7', color: '#166534' },
  question:    { bg: '#dbeafe', color: '#1e40af' },
  unsubscribe: { bg: '#fee2e2', color: '#991b1b' },
  spam:        { bg: '#f3f4f6', color: '#6b7280' },
};

export default function ResponsesPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, any[]>>({});
  const [loadingThreads, setLoadingThreads] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    fetchRecords();
  }, []);

  async function fetchRecords() {
    try {
      setLoading(true);
      const data = await api.getCampaignDashboard();
      setCampaigns(data);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    try {
      setSyncing(true);
      const res = await api.processReplies();
      await fetchRecords();
      const processed = res.processed ?? 0;
      const replied = res.replies_sent ?? 0;
      if (processed > 0 || replied > 0) {
        showToast(`Sync complete!\n- New emails processed: ${processed}\n- Auto-replies sent: ${replied}`, 'success');
      } else {
        showToast('Sync complete — no new messages found.', 'success');
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      showToast(`Sync failed: ${err.message || 'Check backend connection and try again.'}`, 'error');
      await fetchRecords();
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleThread(response: Response) {
    const isExpanding = expandedThread !== response.id;
    setExpandedThread(isExpanding ? response.id : null);
    
    if (isExpanding && response.thread_id && !threads[response.thread_id]) {
      try {
        setLoadingThreads(prev => ({ ...prev, [response.thread_id!]: true }));
        const threadData = await api.getThread(response.thread_id);
        setThreads(prev => ({ ...prev, [response.thread_id!]: threadData }));
      } catch (err) {
        console.error('Failed to load thread:', err);
      } finally {
        setLoadingThreads(prev => ({ ...prev, [response.thread_id!]: false }));
      }
    }
  }

  async function handleDeleteCampaign(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this campaign and all its responses? This cannot be undone.')) return;
    
    try {
      await api.deleteCampaign(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      showToast('Campaign deleted successfully.');
    } catch (err: any) {
      showToast('Failed to delete campaign: ' + err.message, 'error');
    }
  }

  function exportCSV() {
    // Collect all leads from all campaigns
    const allLeads = campaigns.flatMap(c => c.leads.map(l => ({ campaign: c.subject, ...l })));
    if (allLeads.length === 0) return;
    const header = ['Campaign', 'Email', 'Replied', 'Intent', 'Message', 'Reply Sent', 'Timestamp'];
    const rows = allLeads.map(l => [
      `"${(l.campaign || '').replace(/"/g, '""')}"`,
      l.email,
      l.replied ? 'Yes' : 'No',
      l.response?.intent || '',
      `"${(l.response?.message || '').replace(/"/g, '""')}"`,
      l.response?.reply_sent ? 'Yes' : 'No',
      l.response?.timestamp || '',
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campaign_responses.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

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
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>Campaign Responses</h1>
          <p>Track all registered emails per campaign and view AI auto-replies.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={exportCSV} disabled={campaigns.length === 0}>
            Export CSV
          </button>
          <button className="btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync with Gmail'}
          </button>
        </div>
      </div>

      <div className="card table-container" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
            Loading campaigns...
          </div>
        ) : campaigns.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
            No campaigns found. Send a campaign to see registered emails here.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '1rem' }}>Campaign Subject</th>
                <th style={{ textAlign: 'left', padding: '1rem' }}>Date Sent</th>
                <th style={{ textAlign: 'left', padding: '1rem' }}>Registered Mails</th>
                <th style={{ textAlign: 'left', padding: '1rem' }}>Replies</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => {
                const isOpen = expandedCampaign === c.id;
                const totalLeads = c.leads.length;
                const repliesCount = c.leads.filter(l => l.replied).length;
                return (
                  <Fragment key={c.id}>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        background: isOpen ? 'rgba(0,0,0,0.02)' : 'transparent',
                      }}
                      onClick={() => setExpandedCampaign(isOpen ? null : c.id)}
                    >
                      <td style={{ padding: '1rem', fontWeight: 600 }}>{c.subject || 'Untitled Campaign'}</td>
                      <td style={{ padding: '1rem', fontSize: '0.875rem' }}>{new Date(c.timestamp).toLocaleDateString()}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ background: '#e0e7ff', color: '#4338ca', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          {totalLeads} Mails
                        </span>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {repliesCount > 0 ? (
                            <span style={{ color: '#16a34a', fontWeight: 600 }}>{repliesCount} Replied</span>
                          ) : (
                            <span style={{ color: 'var(--muted-foreground)' }}>No replies yet</span>
                          )}
                          <button 
                            onClick={(e) => handleDeleteCampaign(e, c.id)}
                            style={{ 
                              background: 'transparent', 
                              border: 'none', 
                              color: '#ef4444', 
                              padding: '0.25rem 0.5rem', 
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              marginLeft: '1rem',
                              opacity: 0.6,
                              transition: 'opacity 0.2s'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                            onMouseOut={(e) => e.currentTarget.style.opacity = '0.6'}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    
                    {isOpen && (
                      <tr style={{ background: 'var(--muted)' }}>
                        <td colSpan={4} style={{ padding: '0' }}>
                          <div style={{ padding: '1rem 2rem', borderBottom: '1px solid var(--border)' }}>
                            <strong style={{ display: 'block', marginBottom: '1rem', fontSize: '0.875rem' }}>Registered Mails for this Campaign</strong>
                            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                              <thead style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
                                <tr>
                                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.75rem' }}>Email</th>
                                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.75rem' }}>Status</th>
                                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.75rem' }}>Intent</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.leads.map((l, idx) => {
                                  const r = l.response;
                                  const isThreadOpen = r && expandedThread === r.id;
                                  return (
                                    <Fragment key={idx}>
                                      <tr 
                                        style={{ borderBottom: '1px solid var(--border)', cursor: r ? 'pointer' : 'default', background: isThreadOpen ? 'rgba(239, 68, 68, 0.04)' : 'transparent' }}
                                        onClick={() => r ? handleToggleThread(r) : null}
                                      >
                                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{l.email}</td>
                                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                                          {l.replied ? <span style={{ color: '#16a34a', fontWeight: 600 }}>Replied (Click to view)</span> : <span style={{ color: 'var(--muted-foreground)' }}>Waiting</span>}
                                        </td>
                                        <td style={{ padding: '0.75rem 1rem' }}>
                                          {r && r.intent && (
                                            <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: INTENT_COLORS[r.intent]?.bg || '#f3f4f6', color: INTENT_COLORS[r.intent]?.color || '#6b7280' }}>
                                              {r.intent.toUpperCase()}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                      
                                      {isThreadOpen && r && (
                                        <tr style={{ background: '#f9fafb' }}>
                                          <td colSpan={3} style={{ padding: '1.5rem' }}>
                                            {r.thread_id && loadingThreads[r.thread_id] ? (
                                              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading thread...</div>
                                            ) : r.thread_id && threads[r.thread_id] ? (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <strong style={{ fontSize: '0.875rem', color: 'var(--foreground)' }}>Email Thread History</strong>
                                                {threads[r.thread_id].map((msg: any, msgIdx: number) => (
                                                  <div key={msgIdx} style={{
                                                    background: msg.type === 'sent' || msg.type === 'auto_reply' ? 'rgba(22, 163, 74, 0.05)' : 'white',
                                                    border: msg.type === 'sent' || msg.type === 'auto_reply' ? '1px solid rgba(22, 163, 74, 0.1)' : '1px solid rgba(0,0,0,0.08)',
                                                    padding: '1rem',
                                                    borderRadius: '8px',
                                                    marginLeft: msg.type === 'sent' || msg.type === 'auto_reply' ? '2rem' : '0',
                                                    marginRight: msg.type === 'sent' || msg.type === 'auto_reply' ? '0' : '2rem'
                                                  }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                      <strong style={{ fontSize: '0.75rem', color: msg.type === 'sent' || msg.type === 'auto_reply' ? '#16a34a' : 'var(--primary)' }}>
                                                        {msg.type === 'sent' ? 'YOU (Initial)' : msg.type === 'auto_reply' ? 'AI (Auto-reply)' : 'CLIENT'}
                                                      </strong>
                                                      <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>{new Date(msg.timestamp).toLocaleString()}</span>
                                                    </div>
                                                    {msg.intent && (
                                                      <span style={{ display: 'inline-block', marginBottom: '0.5rem', padding: '0.1rem 0.5rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600, background: INTENT_COLORS[msg.intent]?.bg || '#f3f4f6', color: INTENT_COLORS[msg.intent]?.color || '#6b7280' }}>
                                                        {msg.intent.toUpperCase()}
                                                      </span>
                                                    )}
                                                    <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--foreground)' }}>
                                                      {msg.message || msg.body || '(No content)'}
                                                    </pre>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                                <div>
                                                  <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem', color: 'var(--primary)' }}>CLIENT MESSAGE:</strong>
                                                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--foreground)', background: 'white', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                                    {r.message}
                                                  </pre>
                                                </div>
                                                <div>
                                                  <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem', color: '#16a34a' }}>AI RESPONSE:</strong>
                                                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--foreground)', background: 'rgba(22, 163, 74, 0.05)', padding: '1rem', borderRadius: '4px', border: '1px solid rgba(22, 163, 74, 0.1)' }}>
                                                    {r.ai_reply || '(No reply sent)'}
                                                  </pre>
                                                </div>
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
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
