'use client';

import { useEffect, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface LogEntry {
  id: string;
  type?: string;       // 'sent' for campaigns
  intent?: string;     // for auto-replies (interest, question, etc.)
  email?: string;
  recipient?: string;
  name?: string;
  subject?: string;
  message?: string;
  body?: string;
  ai_reply?: string;
  reply_sent?: boolean;
  timestamp: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({
    totalLeads: 0,
    emailsSent: 0,
    clientReplies: 0,
    aiCredits: 'Unlimited',
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [activityTab, setActivityTab] = useState<'campaigns' | 'events'>('campaigns');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    
    // Fetch user profile and dashboard data
    const init = async () => {
      try {
        const [userData, userSettings] = await Promise.all([
          api.getMe(),
          api.getSettings().catch(() => ({ auto_reply_enabled: true }))
        ]);
        setUser(userData);
        setAutoReplyEnabled(userSettings.auto_reply_enabled ?? true);
        await fetchDashboardData();
      } catch (err) {
        console.warn('Auth check failed or token expired:', err);
        localStorage.removeItem('auth_token');
        router.push('/login');
      }
    };
    
    init();
  }, [router]);

  async function handleToggleAutoReply() {
    try {
      const newState = !autoReplyEnabled;
      await api.updateSettings({ auto_reply_enabled: newState });
      setAutoReplyEnabled(newState);
      showToast(newState ? '🚀 Auto-Reply Reactivated!' : '⏸️ Auto-Reply Paused.', 'success');
    } catch (err) {
      showToast('Failed to update auto-reply status', 'error');
    }
  }

  async function fetchDashboardData() {
    try {
      const [leads, recentLogs, dashboardStats, campaignList] = await Promise.all([
        api.getLeads().catch(() => []),
        api.getRecentLogs(50).catch(() => []),
        api.getStats().catch(() => ({ sent: 0, replies: 0 })),
        api.getCampaignDashboard().catch(() => [])
      ]);

      setStats({
        totalLeads: Array.isArray(leads) ? leads.length : 0,
        emailsSent: dashboardStats.sent,
        clientReplies: dashboardStats.replies,
        aiCredits: 'Unlimited',
      });
      setLogs(recentLogs);
      setCampaigns(Array.isArray(campaignList) ? campaignList : []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncReplies() {
    try {
      setSyncing(true);
      const res = await api.processReplies();
      const processed = res.processed ?? 0;
      const replied = res.replies_sent ?? 0;
      const skipped = res.skipped ?? 0;
      showToast(`Sync complete!\n- New emails: ${processed}\n- Auto-replies: ${replied}\n- Already in DB: ${skipped}`, 'success');
      fetchDashboardData(); // Refresh after sync
    } catch (err: any) {
      showToast(`Sync failed: ${err.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  }

  function getActionLabel(log: LogEntry): string {
    if (log.intent) return `Auto-Reply [${log.intent.toUpperCase()}]`;
    if (log.type === 'sent') return 'Email Sent';
    return 'Email Activity';
  }

  function getStatusBadge(log: LogEntry) {
    if (log.intent) {
      const colors: Record<string, { bg: string; color: string }> = {
        interest:    { bg: '#dcfce7', color: '#166534' },
        question:    { bg: '#dbeafe', color: '#1e40af' },
        unsubscribe: { bg: '#fee2e2', color: '#991b1b' },
        spam:        { bg: '#f3f4f6', color: '#6b7280' },
      };
      const c = colors[log.intent] || colors.spam;
      return <span style={{ padding: '0.2rem 0.5rem', background: c.bg, color: c.color, borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>{log.intent}</span>;
    }
    return <span style={{ padding: '0.2rem 0.5rem', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '0.75rem' }}>Sent</span>;
  }

  function getResult(log: LogEntry): string {
    if (log.intent) {
      return log.reply_sent ? `Replied to ${log.name || log.email}` : `Logged: ${log.email}`;
    }
    const toEmail = log.recipient || log.email;
    return `To: ${toEmail || 'Multiple'}`;
  }

  async function handleDeleteLog(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Delete this activity log?')) return;
    try {
      await api.deleteLog(id);
      setLogs(prev => prev.filter(log => log.id !== id));
      showToast('Log deleted successfully.');
    } catch (err) {
      showToast('Failed to delete log.', 'error');
    }
  }

  return (
    <div>
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
          <h1>Dashboard Overview</h1>
          <p>Welcome back to U-marketer. Here&apos;s your performance summary.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button 
            className="btn" 
            style={{ backgroundColor: autoReplyEnabled ? '#ef4444' : '#10b981' }} 
            onClick={handleToggleAutoReply}
          >
            {autoReplyEnabled ? '⏸️ Pause Auto-Reply' : '▶️ Resume Auto-Reply'}
          </button>
          <button className="btn" onClick={handleSyncReplies} disabled={syncing}>
            {syncing ? '⏳ Syncing...' : '🔄 Sync Replies'}
          </button>
        </div>
      </div>

      <div className="grid-stats">
        <div className="card">
          <p className="label">Total Leads</p>
          <h2 style={{ fontSize: '2.5rem', margin: '0.5rem 0' }}>{loading ? '...' : stats.totalLeads}</h2>
          <p style={{ color: 'var(--primary)', fontWeight: 500 }}>In your database</p>
        </div>
        <div className="card">
          <p className="label">Emails Sent (recent)</p>
          <h2 style={{ fontSize: '2.5rem', margin: '0.5rem 0' }}>{loading ? '...' : stats.emailsSent}</h2>
          <p style={{ color: '#10b981', fontWeight: 500 }}>Last 10 logged actions</p>
        </div>
        <div className="card">
          <p className="label">Client Replies</p>
          <h2 style={{ fontSize: '2.5rem', margin: '0.5rem 0' }}>{loading ? '...' : stats.clientReplies}</h2>
          <p style={{ color: 'var(--muted-foreground)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/responses')}>View all responses</p>
        </div>
        <div className="card">
          <p className="label">AI Token Credits</p>
          <h2 style={{ fontSize: '2.5rem', margin: '0.5rem 0' }}>{stats.aiCredits}</h2>
          <p style={{ color: 'var(--primary)', fontWeight: 500 }}>Premium Plan</p>
        </div>
      </div>

      <section style={{ marginTop: '3rem' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '1.5rem', 
          flexWrap: 'wrap', 
          gap: '1rem' 
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700 }}>
              {activityTab === 'campaigns' ? 'Campaign Records Management' : 'Individual Activity Log'}
            </h2>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              {activityTab === 'campaigns' 
                ? 'Each campaign is organized as an independent record with live response tracking.'
                : 'Raw system event log of all inbound client responses and outbound dispatches.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* View Switcher Tabs */}
            <div style={{ display: 'flex', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <button
                onClick={() => setActivityTab('campaigns')}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  background: activityTab === 'campaigns' ? 'var(--primary)' : 'var(--card)',
                  color: activityTab === 'campaigns' ? '#ffffff' : 'var(--muted-foreground)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                📁 Campaign Records ({campaigns.length})
              </button>
              <button
                onClick={() => setActivityTab('events')}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  background: activityTab === 'events' ? 'var(--primary)' : 'var(--card)',
                  color: activityTab === 'events' ? '#ffffff' : 'var(--muted-foreground)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                📜 Raw Events ({logs.length})
              </button>
            </div>

            <button className="btn btn-outline" onClick={() => router.push('/campaign-dashboard')} style={{ fontSize: '0.825rem', padding: '0.45rem 0.85rem' }}>
              📈 Full Analytics
            </button>
          </div>
        </div>

        {/* TAB 1: CAMPAIGN RECORDS (PRIMARY & ORGANIZED) */}
        {activityTab === 'campaigns' && (
          <div className="card" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                Loading campaign records...
              </div>
            ) : campaigns.length === 0 ? (
              <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem' }}>🎯</span>
                <h3 style={{ fontSize: '1.15rem', marginBottom: '0.35rem' }}>No campaigns launched yet</h3>
                <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', maxWidth: '380px', margin: '0 auto 1.25rem' }}>
                  Create an email campaign from the Campaigns section to start building your marketing records.
                </p>
                <button className="btn" onClick={() => router.push('/campaigns')}>
                  Create Campaign
                </button>
              </div>
            ) : (
              <div className="table-container">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--muted)', textAlign: 'left' }}>
                      <th style={{ padding: '1rem' }}>Campaign Subject</th>
                      <th style={{ padding: '1rem' }}>Launched</th>
                      <th style={{ padding: '1rem' }}>Target Leads</th>
                      <th style={{ padding: '1rem' }}>Responses</th>
                      <th style={{ padding: '1rem' }}>Reply Rate</th>
                      <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((camp) => {
                      const leadsCount = camp.leads?.length || 0;
                      const repliesCount = camp.leads?.filter((l: any) => l.replied)?.length || 0;
                      const rate = leadsCount > 0 ? Math.round((repliesCount / leadsCount) * 100) : 0;

                      return (
                        <tr 
                          key={camp.id} 
                          style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => router.push(`/campaign-dashboard?campaign=${camp.id}`)}
                        >
                          <td style={{ padding: '1rem' }}>
                            <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                              {camp.subject}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: '0.2rem' }}>
                              ID: {camp.id.length > 20 ? camp.id.substring(0, 20) + '...' : camp.id}
                            </div>
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--muted-foreground)', fontSize: '0.825rem' }}>
                            {camp.timestamp ? new Date(camp.timestamp).toLocaleDateString() : 'Active'}
                          </td>
                          <td style={{ padding: '1rem', fontWeight: 600 }}>
                            {leadsCount} leads
                          </td>
                          <td style={{ padding: '1rem' }}>
                            <span style={{ 
                              padding: '0.2rem 0.5rem', 
                              borderRadius: '4px', 
                              fontSize: '0.75rem', 
                              fontWeight: 600,
                              background: repliesCount > 0 ? '#dcfce7' : 'var(--muted)',
                              color: repliesCount > 0 ? '#166534' : 'var(--muted-foreground)'
                            }}>
                              {repliesCount} replies
                            </span>
                          </td>
                          <td style={{ padding: '1rem' }}>
                            <span style={{ 
                              padding: '0.2rem 0.55rem', 
                              borderRadius: '6px', 
                              fontSize: '0.75rem', 
                              fontWeight: 700,
                              background: rate > 15 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(99, 102, 241, 0.12)',
                              color: rate > 15 ? '#10b981' : '#6366f1'
                            }}>
                              {rate}%
                            </span>
                          </td>
                          <td style={{ padding: '1rem', textAlign: 'right' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/campaign-dashboard?campaign=${camp.id}`);
                              }}
                              style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: '6px',
                                background: 'rgba(99, 102, 241, 0.1)',
                                color: 'var(--primary)',
                                border: '1px solid rgba(99, 102, 241, 0.25)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              📊 Analytics →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RAW EVENT LOGS */}
        {activityTab === 'events' && (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-container">
              {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading activity...</div>
              ) : logs.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                  No activity events recorded yet.
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Result</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const isExpanded = expandedId === log.id;
                      return (
                        <Fragment key={log.id}>
                          <tr 
                            style={{ cursor: 'pointer', borderBottom: isExpanded ? 'none' : '1px solid var(--border)' }} 
                            onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          >
                            <td><strong>{getActionLabel(log)}</strong></td>
                            <td>{getStatusBadge(log)}</td>
                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                            <td>{getResult(log)}</td>
                            <td>
                              <button 
                                onClick={(e) => handleDeleteLog(e, log.id)}
                                style={{ 
                                  background: 'transparent', 
                                  border: 'none', 
                                  color: '#ef4444', 
                                  fontSize: '0.75rem', 
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  opacity: 0.7
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                              <td colSpan={5} style={{ padding: '1.25rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: log.message && log.ai_reply ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
                                  {log.subject && (
                                    <div style={{ gridColumn: '1 / -1' }}>
                                      <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.35rem', color: 'var(--primary)' }}>SUBJECT:</strong>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--foreground)' }}>{log.subject}</div>
                                    </div>
                                  )}
                                  {log.message && (
                                    <div>
                                      <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.35rem', color: 'var(--primary)' }}>MESSAGE CONTENT:</strong>
                                      <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--foreground)', background: 'rgba(0,0,0,0.03)', padding: '0.85rem', borderRadius: '4px' }}>
                                        {log.message}
                                      </pre>
                                    </div>
                                  )}
                                  {log.body && (
                                    <div>
                                      <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.35rem', color: 'var(--primary)' }}>EMAIL BODY:</strong>
                                      <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--foreground)', background: 'rgba(0,0,0,0.03)', padding: '0.85rem', borderRadius: '4px' }}>
                                        {log.body}
                                      </pre>
                                    </div>
                                  )}
                                  {log.ai_reply && (
                                    <div>
                                      <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.35rem', color: '#16a34a' }}>AI RESPONSE:</strong>
                                      <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--foreground)', background: 'rgba(22, 163, 74, 0.05)', padding: '0.85rem', borderRadius: '4px', border: '1px solid rgba(22, 163, 74, 0.1)' }}>
                                        {log.ai_reply}
                                      </pre>
                                    </div>
                                  )}
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
          </div>
        )}
      </section>
      </div>
    );
  }
