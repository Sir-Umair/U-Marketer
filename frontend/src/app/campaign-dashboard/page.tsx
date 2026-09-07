'use client';

import React, { useEffect, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface LeadStatus {
  email: string;
  replied: boolean;
  response: any | null;
}

interface Campaign {
  id: string;
  subject: string;
  timestamp: string;
  leads: LeadStatus[];
}

export default function CampaignDashboard() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const data = await api.getCampaignDashboard();
      setCampaigns(data);
      // Auto-expand the first campaign if exists
      if (data.length > 0 && !expandedCampaign) {
        setExpandedCampaign(data[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    try {
      setSyncing(true);
      await api.processReplies();
      await fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteCampaign(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this campaign and all its activity logs? This cannot be undone.')) return;
    
    try {
      await api.deleteCampaign(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (expandedCampaign === id) setExpandedCampaign(null);
    } catch (err: any) {
      alert('Failed to delete campaign: ' + err.message);
    }
  }

  return (
    <div style={{ padding: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 800, marginBottom: '0.5rem', background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Campaign Intelligence
          </h1>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '1.05rem' }}>Detailed breakdown of lead engagement per outreach campaign.</p>
        </div>
        <button 
          className="btn" 
          onClick={handleSync} 
          disabled={syncing}
          style={{ background: 'var(--primary)', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '12px', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.2)' }}
        >
          {syncing ? '⏳ Syncing Data...' : '🔄 Refresh Status'}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
            <p style={{ color: 'var(--muted-foreground)' }}>Analyzing campaigns...</p>
          </div>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card" style={{ padding: '5rem', textAlign: 'center', background: 'rgba(0,0,0,0.02)', border: '2px dashed var(--border)' }}>
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: '1.5rem' }}>🎯</span>
          <h3>No campaigns found yet</h3>
          <p style={{ color: 'var(--muted-foreground)', maxWidth: '400px', margin: '1rem auto' }}>
            Once you launch an email campaign from the Campaigns page, it will appear here with real-time response tracking.
          </p>
          <button className="btn" onClick={() => router.push('/campaigns')} style={{ marginTop: '1rem' }}>Create First Campaign</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {campaigns.map((campaign) => {
            const isExpanded = expandedCampaign === campaign.id;
            const replyCount = campaign.leads.filter(l => l.replied).length;
            const totalLeads = campaign.leads.length;
            const rate = totalLeads > 0 ? Math.round((replyCount / totalLeads) * 100) : 0;

            return (
              <div 
                key={campaign.id} 
                className="card" 
                style={{ 
                  padding: 0, 
                  overflow: 'hidden', 
                  border: isExpanded ? '2px solid #4f46e5' : '1px solid var(--border)',
                  boxShadow: isExpanded ? '0 12px 24px rgba(0,0,0,0.08)' : 'var(--shadow)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {/* Campaign Header */}
                <div 
                  style={{ 
                    padding: '1.5rem 2rem', 
                    background: isExpanded ? 'linear-gradient(to right, #f8fafc, #eff6ff)' : 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onClick={() => setExpandedCampaign(isExpanded ? null : campaign.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.25rem' }}>
                      <span style={{ background: '#4f46e5', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>CAMPAIGN</span>
                      <span style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>{new Date(campaign.timestamp).toLocaleDateString()}</span>
                    </div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{campaign.subject}</h2>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#4f46e5' }}>{rate}%</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', fontWeight: 600 }}>REPLY RATE</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{totalLeads}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', fontWeight: 600 }}>TARGETS</div>
                    </div>
                    <button 
                      onClick={(e) => handleDeleteCampaign(e, campaign.id)}
                      style={{ 
                        background: 'transparent', 
                        border: '1px solid #fee2e2', 
                        color: '#ef4444', 
                        padding: '0.5rem', 
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = '#fee2e2'}
                      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      Delete
                    </button>
                    <div style={{ fontSize: '1.5rem', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>▼</div>
                  </div>
                </div>

                {/* Lead List */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '1rem' }}>
                    <div className="table-container" style={{ background: '#f9fafb', borderRadius: '12px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f1f5f9', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                            <th style={{ padding: '1rem 1.5rem', textAlign: 'left' }}>Lead / Contact</th>
                            <th style={{ padding: '1rem 1.5rem', textAlign: 'left' }}>Status</th>
                            <th style={{ padding: '1rem 1.5rem', textAlign: 'left' }}>Action / Response</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaign.leads.map((lead, idx) => (
                            <Fragment key={idx}>
                              <tr style={{ borderBottom: '1px solid #e2e8f0', background: lead.replied ? '#ecfdf5' : 'transparent' }}>
                                <td style={{ padding: '1.25rem 1.5rem' }}>
                                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{lead.email}</div>
                                </td>
                                <td style={{ padding: '1.25rem 1.5rem' }}>
                                  {lead.replied ? (
                                    <span style={{ background: '#10b981', color: 'white', padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>REPLIED</span>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No reply found</span>
                                  )}
                                </td>
                                <td style={{ padding: '1.25rem 1.5rem' }}>
                                  {lead.replied && (
                                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#059669' }}>
                                      Intent: {lead.response.intent?.toUpperCase()}
                                    </div>
                                  )}
                                </td>
                              </tr>
                              {lead.replied && lead.response && (
                                <tr>
                                  <td colSpan={3} style={{ padding: '0 1.5rem 1.5rem' }}>
                                    <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid #10b981', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span>📬</span> ORIGINAL MESSAGE RECEIVED:
                                      </div>
                                      <pre style={{ 
                                        margin: 0, 
                                        whiteSpace: 'pre-wrap', 
                                        wordBreak: 'break-word', 
                                        fontSize: '0.875rem', 
                                        lineHeight: '1.6', 
                                        fontFamily: 'inherit',
                                        color: '#334155'
                                      }}>
                                        {lead.response.message}
                                      </pre>
                                      {lead.response.ai_reply && (
                                        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#6366f1', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span>🤖</span> AI AUTO-REPLY SENT:
                                          </div>
                                          <div style={{ fontSize: '0.875rem', color: '#475569', fontStyle: 'italic', background: '#f5f3ff', padding: '1rem', borderRadius: '6px' }}>
                                            {lead.response.ai_reply}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
}
