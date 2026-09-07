'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface LeadStatus {
  email: string;
  replied: boolean;
  response: any | null;
  sent_at?: string;
  subject?: string;
  body?: string;
  thread_id?: string;
  follow_up_delay?: number;
  follow_up_sent?: boolean;
}

interface Campaign {
  id: string;
  subject: string;
  timestamp: string;
  total_leads?: number;
  emails_sent?: number;
  replies_count?: number;
  reply_rate?: number;
  leads: LeadStatus[];
}

function CampaignDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('ALL');
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<'all' | 'replied' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewLead, setPreviewLead] = useState<LeadStatus | null>(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    fetchData();
  }, [router]);

  // Set selected campaign if URL has ?campaign=...
  useEffect(() => {
    const cid = searchParams.get('campaign');
    if (cid) {
      setSelectedCampaignId(cid);
      setExpandedCampaignId(cid);
    }
  }, [searchParams]);

  async function fetchData() {
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
      await api.processReplies();
      await fetchData();
    } catch (err) {
      console.error('Failed to sync replies:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteCampaign(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this campaign and all its activity records? This cannot be undone.')) return;

    try {
      await api.deleteCampaign(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (selectedCampaignId === id) setSelectedCampaignId('ALL');
      if (expandedCampaignId === id) setExpandedCampaignId(null);
    } catch (err: any) {
      alert('Failed to delete campaign: ' + err.message);
    }
  }

  // Active campaign when single campaign is selected
  const activeCampaign = useMemo(() => {
    if (selectedCampaignId === 'ALL') return null;
    return campaigns.find(c => c.id === selectedCampaignId) || null;
  }, [campaigns, selectedCampaignId]);

  // Aggregated or single metrics
  const metrics = useMemo(() => {
    if (activeCampaign) {
      const totalLeads = activeCampaign.leads.length;
      const replied = activeCampaign.leads.filter(l => l.replied).length;
      const rate = totalLeads > 0 ? Math.round((replied / totalLeads) * 100) : 0;
      return {
        scope: 'single',
        campaignCount: 1,
        totalLeads,
        emailsSent: totalLeads,
        replies: replied,
        replyRate: rate,
        title: activeCampaign.subject || 'Untitled Campaign',
        date: activeCampaign.timestamp ? new Date(activeCampaign.timestamp).toLocaleDateString() : 'Recent'
      };
    }

    // Portfolio aggregate
    const totalLeads = campaigns.reduce((acc, c) => acc + (c.leads?.length || 0), 0);
    const replies = campaigns.reduce((acc, c) => acc + (c.leads?.filter(l => l.replied)?.length || 0), 0);
    const replyRate = totalLeads > 0 ? Math.round((replies / totalLeads) * 100) : 0;

    return {
      scope: 'all',
      campaignCount: campaigns.length,
      totalLeads,
      emailsSent: totalLeads,
      replies,
      replyRate,
      title: 'Overall Portfolio Analytics',
      date: 'All Time'
    };
  }, [campaigns, activeCampaign]);

  // Filtered leads for the single campaign view
  const filteredActiveLeads = useMemo(() => {
    if (!activeCampaign) return [];
    return activeCampaign.leads.filter(lead => {
      if (leadFilter === 'replied' && !lead.replied) return false;
      if (leadFilter === 'pending' && lead.replied) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesEmail = lead.email.toLowerCase().includes(q);
        const matchesSubj = (lead.subject || '').toLowerCase().includes(q);
        const matchesIntent = (lead.response?.intent || '').toLowerCase().includes(q);
        if (!matchesEmail && !matchesSubj && !matchesIntent) return false;
      }
      return true;
    });
  }, [activeCampaign, leadFilter, searchQuery]);

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', paddingBottom: '3rem' }}>
      
      {/* Top Header & Strategic Action Bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start', 
        marginBottom: '1.75rem', 
        flexWrap: 'wrap', 
        gap: '1rem' 
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
            <span style={{ 
              fontSize: '0.75rem', 
              fontWeight: 700, 
              textTransform: 'uppercase', 
              letterSpacing: '0.06em', 
              padding: '0.2rem 0.6rem', 
              borderRadius: '9999px',
              background: activeCampaign ? '#e0e7ff' : '#f1f5f9',
              color: activeCampaign ? '#4338ca' : '#475569'
            }}>
              {activeCampaign ? '🎯 Single Campaign Drilldown' : '📊 Portfolio Overview'}
            </span>
            {activeCampaign && (
              <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                Launched {metrics.date}
              </span>
            )}
          </div>
          <div 
            onClick={() => setShowCampaignPicker(true)}
            role="button"
            tabIndex={0}
            style={{ 
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              margin: '0 0 0.35rem 0',
              padding: '0.2rem 0.5rem',
              marginLeft: '-0.5rem',
              borderRadius: '8px',
              transition: 'background 0.15s ease'
            }}
            title="Click to switch campaign record"
          >
            <h1 style={{ 
              fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', 
              fontWeight: 800, 
              lineHeight: 1.2, 
              margin: 0,
              color: 'var(--foreground)'
            }}>
              {metrics.title}
            </h1>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: 'var(--primary)',
              background: 'rgba(99, 102, 241, 0.12)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              padding: '0.35rem 0.75rem',
              borderRadius: '9999px',
              boxShadow: '0 2px 4px rgba(99, 102, 241, 0.08)'
            }}>
              <span>{activeCampaign ? 'Switch Campaign' : 'Select Campaign'}</span>
              <span style={{ fontSize: '0.7rem' }}>▼</span>
            </span>
          </div>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.95rem', margin: 0 }}>
            {activeCampaign 
              ? `Isolated analytics, delivery audit, and client engagement for this specific campaign.`
              : `High-level record management and conversion analytics across all active campaigns. Click heading to isolate any campaign.`}
          </p>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {activeCampaign && (
            <button
              className="btn btn-outline"
              onClick={() => {
                setSelectedCampaignId('ALL');
                setExpandedCampaignId(null);
              }}
              style={{ padding: '0.65rem 1.15rem', borderRadius: '10px', fontSize: '0.875rem' }}
            >
              ✕ View All Campaigns
            </button>
          )}
          <button 
            className="btn" 
            onClick={handleSync} 
            disabled={syncing}
            style={{ 
              background: 'var(--primary)', 
              color: 'white', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '10px',
              fontSize: '0.875rem',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)'
            }}
          >
            {syncing ? '⏳ Syncing...' : '🔄 Sync Replies'}
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => router.push('/campaigns')}
            style={{ padding: '0.65rem 1.15rem', borderRadius: '10px', fontSize: '0.875rem' }}
          >
            + New Campaign
          </button>
        </div>
      </div>

      {/* Campaign Selector Navigation Pills (Horizontal Mobile Scroll) */}
      {campaigns.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          paddingBottom: '0.75rem',
          marginBottom: '1.5rem',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin'
        }}>
          <button
            onClick={() => {
              setSelectedCampaignId('ALL');
              setExpandedCampaignId(null);
            }}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: '9999px',
              fontSize: '0.825rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              border: '1px solid',
              borderColor: selectedCampaignId === 'ALL' ? 'var(--primary)' : 'var(--border)',
              background: selectedCampaignId === 'ALL' ? 'var(--primary)' : 'var(--card)',
              color: selectedCampaignId === 'ALL' ? '#ffffff' : 'var(--foreground)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              flexShrink: 0
            }}
          >
            🌟 All Campaigns ({campaigns.length})
          </button>

          {campaigns.map((c) => {
            const isSelected = selectedCampaignId === c.id;
            const leadsCount = c.leads?.length || 0;
            const repliesCount = c.leads?.filter(l => l.replied)?.length || 0;

            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCampaignId(c.id);
                  setExpandedCampaignId(c.id);
                }}
                style={{
                  padding: '0.55rem 1.1rem',
                  borderRadius: '9999px',
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--primary)' : 'var(--border)',
                  background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'var(--card)',
                  color: isSelected ? 'var(--primary)' : 'var(--foreground)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  flexShrink: 0
                }}
              >
                <span>✉️ {c.subject.length > 28 ? c.subject.substring(0, 28) + '...' : c.subject}</span>
                <span style={{ 
                  fontSize: '0.7rem', 
                  padding: '0.15rem 0.45rem', 
                  borderRadius: '6px', 
                  background: isSelected ? 'var(--primary)' : 'var(--muted)',
                  color: isSelected ? '#ffffff' : 'var(--muted-foreground)'
                }}>
                  {repliesCount}/{leadsCount} replies
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Analytics Cards Grid (Dynamically Calculated for Selected Campaign or Portfolio) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1.25rem',
        marginBottom: '2rem'
      }}>
        {/* Metric 1 */}
        <div className="card" style={{ padding: '1.25rem 1.5rem', position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
              {activeCampaign ? 'Campaign Targets' : 'Total Campaigns'}
            </span>
            <span style={{ fontSize: '1.25rem' }}>{activeCampaign ? '👥' : '📁'}</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, margin: '0.4rem 0 0.2rem 0', color: 'var(--foreground)' }}>
            {loading ? '...' : (activeCampaign ? metrics.totalLeads : metrics.campaignCount)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 500 }}>
            {activeCampaign ? `${activeCampaign.leads.length} validated leads` : `${metrics.totalLeads} total leads across portfolio`}
          </div>
        </div>

        {/* Metric 2 */}
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
              Emails Delivered
            </span>
            <span style={{ fontSize: '1.25rem' }}>🚀</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, margin: '0.4rem 0 0.2rem 0', color: 'var(--foreground)' }}>
            {loading ? '...' : metrics.emailsSent}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 500 }}>
            Paced human delivery
          </div>
        </div>

        {/* Metric 3 */}
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
              Client Responses
            </span>
            <span style={{ fontSize: '1.25rem' }}>💬</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, margin: '0.4rem 0 0.2rem 0', color: '#6366f1' }}>
            {loading ? '...' : metrics.replies}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
            Inbound replies detected
          </div>
        </div>

        {/* Metric 4 */}
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
              Conversion Rate
            </span>
            <span style={{ fontSize: '1.25rem' }}>🎯</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, margin: '0.4rem 0 0.2rem 0', color: metrics.replyRate > 15 ? '#10b981' : '#f59e0b' }}>
            {loading ? '...' : `${metrics.replyRate}%`}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
            {metrics.replyRate > 20 ? '🔥 High Engagement' : metrics.replyRate > 0 ? '✓ Active Feedback' : 'Awaiting responses'}
          </div>
        </div>
      </div>

      {/* Loading Spinner */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '280px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spinner" style={{ 
              width: '36px', 
              height: '36px', 
              border: '3px solid var(--border)', 
              borderTopColor: 'var(--primary)', 
              borderRadius: '50%', 
              animation: 'spin 0.8s linear infinite', 
              margin: '0 auto 1rem' 
            }} />
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.9rem' }}>Loading campaign intelligence...</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && campaigns.length === 0 && (
        <div className="card" style={{ padding: '4rem 2rem', textAlign: 'center', background: 'var(--card)', border: '2px dashed var(--border)' }}>
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem' }}>🎯</span>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No campaigns found yet</h3>
          <p style={{ color: 'var(--muted-foreground)', maxWidth: '420px', margin: '0 auto 1.5rem auto', fontSize: '0.9rem' }}>
            Once you launch an outreach campaign from the Campaigns page, each campaign will be logged here as an individual record with live reply tracking.
          </p>
          <button className="btn" onClick={() => router.push('/campaigns')}>
            Launch Your First Campaign
          </button>
        </div>
      )}

      {/* VIEW A: SINGLE CAMPAIGN DRILLDOWN VIEW */}
      {!loading && activeCampaign && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '1.25rem', 
            flexWrap: 'wrap', 
            gap: '1rem' 
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                Target Leads in this Campaign
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
                Showing {filteredActiveLeads.length} of {activeCampaign.leads.length} contacts
              </p>
            </div>

            {/* Filter Tabs & Search */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search lead email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  fontSize: '0.825rem',
                  outline: 'none',
                  minWidth: '180px'
                }}
              />
              <div style={{ display: 'flex', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                {(['all', 'replied', 'pending'] as const).map((filterType) => (
                  <button
                    key={filterType}
                    onClick={() => setLeadFilter(filterType)}
                    style={{
                      padding: '0.45rem 0.85rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      background: leadFilter === filterType ? 'var(--primary)' : 'var(--card)',
                      color: leadFilter === filterType ? '#ffffff' : 'var(--muted-foreground)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {filterType === 'all' ? 'All' : filterType === 'replied' ? '✓ Replied' : '⏳ Awaiting'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Leads Table */}
          <div className="table-container" style={{ borderRadius: '10px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--muted)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Contact / Lead</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Sent At</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Response Activity</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredActiveLeads.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                      No leads match your current filter.
                    </td>
                  </tr>
                ) : (
                  filteredActiveLeads.map((lead, idx) => (
                    <tr 
                      key={idx} 
                      style={{ 
                        borderBottom: '1px solid var(--border)',
                        background: lead.replied ? 'rgba(16, 185, 129, 0.04)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{lead.email}</div>
                        {lead.subject && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: '0.2rem' }}>
                            Subject: {lead.subject}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {lead.replied ? (
                          <span style={{ 
                            background: '#dcfce7', 
                            color: '#166534', 
                            padding: '0.25rem 0.6rem', 
                            borderRadius: '6px', 
                            fontSize: '0.75rem', 
                            fontWeight: 700 
                          }}>
                            ✓ REPLIED
                          </span>
                        ) : (
                          <span style={{ 
                            background: 'var(--muted)', 
                            color: 'var(--muted-foreground)', 
                            padding: '0.25rem 0.6rem', 
                            borderRadius: '6px', 
                            fontSize: '0.75rem', 
                            fontWeight: 600 
                          }}>
                            Awaiting Reply
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: 'var(--muted-foreground)', fontSize: '0.8rem' }}>
                        {lead.sent_at ? new Date(lead.sent_at).toLocaleString() : 'Delivered'}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {lead.response ? (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                              <span style={{ 
                                background: '#dbeafe', 
                                color: '#1e40af', 
                                padding: '0.15rem 0.45rem', 
                                borderRadius: '4px', 
                                fontSize: '0.7rem', 
                                fontWeight: 700 
                              }}>
                                {lead.response.intent ? lead.response.intent.toUpperCase() : 'REPLY'}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                                {lead.response.reply_sent ? '⚡ Auto-Replied' : 'Logged'}
                              </span>
                            </div>
                            <div style={{ 
                              fontSize: '0.8rem', 
                              color: 'var(--foreground)', 
                              maxWidth: '320px', 
                              whiteSpace: 'nowrap', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis' 
                            }}>
                              &ldquo;{lead.response.message || lead.response.snippet || 'Client responded'}&rdquo;
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                            No client reply yet
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                        <button
                          onClick={() => setPreviewLead(lead)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            background: 'var(--card)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          🔍 Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW B: ALL CAMPAIGNS RECORD MANAGEMENT SYSTEM (SEPARATE PER-CAMPAIGN CARDS) */}
      {!loading && !activeCampaign && campaigns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
              All Campaign Records ({campaigns.length})
            </h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
              Click any campaign heading or button to isolate its full record & leads.
            </span>
          </div>

          {campaigns.map((campaign) => {
            const isExpanded = expandedCampaignId === campaign.id;
            const leadsCount = campaign.leads?.length || 0;
            const repliedCount = campaign.leads?.filter(l => l.replied)?.length || 0;
            const rate = leadsCount > 0 ? Math.round((repliedCount / leadsCount) * 100) : 0;

            return (
              <div 
                key={campaign.id} 
                className="card"
                style={{ 
                  padding: 0, 
                  overflow: 'hidden',
                  border: isExpanded ? '2px solid var(--primary)' : '1px solid var(--border)',
                  boxShadow: isExpanded ? '0 8px 24px rgba(99, 102, 241, 0.12)' : 'var(--shadow-sm)',
                  transition: 'all 0.2s ease'
                }}
              >
                {/* Campaign Summary Bar */}
                <div 
                  style={{ 
                    padding: '1.25rem 1.5rem', 
                    background: isExpanded ? 'rgba(99, 102, 241, 0.04)' : 'var(--card)',
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    flexWrap: 'wrap', 
                    gap: '1rem',
                    cursor: 'pointer'
                  }}
                  onClick={() => setExpandedCampaignId(isExpanded ? null : campaign.id)}
                >
                  <div style={{ flex: '1 1 280px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ 
                        background: 'var(--primary)', 
                        color: '#ffffff', 
                        padding: '0.2rem 0.55rem', 
                        borderRadius: '6px', 
                        fontSize: '0.7rem', 
                        fontWeight: 700 
                      }}>
                        CAMPAIGN
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                        {campaign.timestamp ? new Date(campaign.timestamp).toLocaleDateString() : 'Active'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                        • {leadsCount} targets
                      </span>
                    </div>
                    <h3 style={{ 
                      margin: 0, 
                      fontSize: '1.15rem', 
                      fontWeight: 700, 
                      color: 'var(--foreground)'
                    }}>
                      {campaign.subject}
                    </h3>
                  </div>

                  {/* Right Side Stats & Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                    {/* Reply Rate Metric */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: rate > 15 ? '#10b981' : '#6366f1' }}>
                        {rate}%
                      </div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted-foreground)' }}>
                        REPLY RATE
                      </div>
                    </div>

                    {/* Targets Metric */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--foreground)' }}>
                        {repliedCount} / {leadsCount}
                      </div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted-foreground)' }}>
                        REPLIES / LEADS
                      </div>
                    </div>

                    {/* Button to Drill Down into this Single Campaign */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCampaignId(campaign.id);
                        setExpandedCampaignId(campaign.id);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        background: 'rgba(99, 102, 241, 0.1)',
                        color: 'var(--primary)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      📊 View Analytics
                    </button>

                    {/* Delete Campaign */}
                    <button
                      onClick={(e) => handleDeleteCampaign(e, campaign.id)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '8px',
                        background: 'transparent',
                        color: '#ef4444',
                        border: '1px solid #fee2e2',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Delete
                    </button>

                    {/* Accordion Arrow */}
                    <span style={{ 
                      fontSize: '1rem', 
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', 
                      transition: 'transform 0.2s ease',
                      color: 'var(--muted-foreground)'
                    }}>
                      ▼
                    </span>
                  </div>
                </div>

                {/* Inline Expanded Leads List */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '1.25rem', background: 'var(--background)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '0.875rem' }}>
                        Leads & Deliveries ({campaign.leads.length})
                      </strong>
                      <button
                        onClick={() => {
                          setSelectedCampaignId(campaign.id);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none' }}
                      >
                        Open Full Campaign Workspace →
                      </button>
                    </div>

                    <div className="table-container" style={{ background: 'var(--card)', borderRadius: '8px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                        <thead>
                          <tr style={{ background: 'var(--muted)', textAlign: 'left' }}>
                            <th style={{ padding: '0.75rem 1rem' }}>Recipient</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Response Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaign.leads.map((lead, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>
                                {lead.email}
                              </td>
                              <td style={{ padding: '0.75rem 1rem' }}>
                                {lead.replied ? (
                                  <span style={{ background: '#dcfce7', color: '#166534', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>
                                    ✓ REPLIED
                                  </span>
                                ) : (
                                  <span style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>
                                    Awaiting
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '0.75rem 1rem', color: 'var(--muted-foreground)' }}>
                                {lead.response ? (
                                  <div>
                                    <span style={{ fontWeight: 600, color: '#1e40af', marginRight: '0.4rem' }}>
                                      [{lead.response.intent || 'REPLY'}]:
                                    </span>
                                    <span>{lead.response.message || 'Client responded'}</span>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
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

      {/* Interactive Top Heading Campaign Picker Modal */}
      {showCampaignPicker && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={() => setShowCampaignPicker(false)}
        >
          <div 
            className="card" 
            style={{
              maxWidth: '620px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              border: '1px solid var(--border)',
              background: 'var(--card)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Select Campaign Record</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
                  Choose a campaign to isolate its analytics and lead records.
                </p>
              </div>
              <button 
                onClick={() => setShowCampaignPicker(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--muted-foreground)' }}
              >
                ✕
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 Search campaigns by subject..."
              value={campaignSearchQuery}
              onChange={(e) => setCampaignSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: '0.9rem',
                marginBottom: '1rem'
              }}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {/* Portfolio Option */}
              <div
                onClick={() => {
                  setSelectedCampaignId('ALL');
                  setExpandedCampaignId(null);
                  setShowCampaignPicker(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: selectedCampaignId === 'ALL' ? 'var(--primary)' : 'var(--border)',
                  background: selectedCampaignId === 'ALL' ? 'rgba(99, 102, 241, 0.08)' : 'var(--card)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: 'var(--foreground)' }}>🌟 Overall Portfolio (All Campaigns)</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                    {campaigns.length} campaigns
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', marginTop: '0.25rem' }}>
                  Aggregated analytics across all campaigns in your outreach portfolio
                </div>
              </div>

              {/* Individual Campaign Records */}
              {campaigns
                .filter(c => (c.subject || '').toLowerCase().includes(campaignSearchQuery.toLowerCase()))
                .map(c => {
                  const isCurrent = selectedCampaignId === c.id;
                  const leadsCount = c.leads?.length || 0;
                  const repliesCount = c.leads?.filter(l => l.replied)?.length || 0;
                  const rate = leadsCount > 0 ? Math.round((repliesCount / leadsCount) * 100) : 0;

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedCampaignId(c.id);
                        setExpandedCampaignId(c.id);
                        setShowCampaignPicker(false);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      style={{
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: isCurrent ? 'var(--primary)' : 'var(--border)',
                        background: isCurrent ? 'rgba(99, 102, 241, 0.08)' : 'var(--card)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                        <strong style={{ color: 'var(--foreground)', fontSize: '0.95rem' }}>
                          {c.subject}
                        </strong>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          background: rate > 15 ? '#dcfce7' : 'rgba(99, 102, 241, 0.12)',
                          color: rate > 15 ? '#166534' : 'var(--primary)'
                        }}>
                          {rate}% Reply Rate
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                        <span>Launched {c.timestamp ? new Date(c.timestamp).toLocaleDateString() : 'Recent'}</span>
                        <span>{repliesCount} replies / {leadsCount} targets</span>
                      </div>
                    </div>
                  );
                })}

              {campaigns.length === 0 && (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.9rem' }}>
                  No campaigns launched yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lead Inspector Modal */}
      {previewLead && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={() => setPreviewLead(null)}
        >
          <div 
            className="card" 
            style={{
              maxWidth: '680px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '1.75rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              border: '1px solid var(--border)',
              background: 'var(--card)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.85rem' }}>
              <div>
                <span style={{ 
                  fontSize: '0.7rem', 
                  fontWeight: 700, 
                  textTransform: 'uppercase', 
                  color: 'var(--primary)',
                  letterSpacing: '0.05em' 
                }}>
                  Lead Delivery Audit
                </span>
                <h3 style={{ margin: '0.2rem 0 0 0', fontSize: '1.2rem', fontWeight: 700 }}>
                  {previewLead.email}
                </h3>
              </div>
              <button 
                onClick={() => setPreviewLead(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--muted-foreground)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <span style={{
                padding: '0.25rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 700,
                background: previewLead.replied ? '#dcfce7' : '#f1f5f9',
                color: previewLead.replied ? '#166534' : '#475569'
              }}>
                {previewLead.replied ? '✓ Inbound Response Detected' : '⏳ Awaiting Inbound Response'}
              </span>
              {previewLead.sent_at && (
                <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', alignSelf: 'center' }}>
                  Sent: {new Date(previewLead.sent_at).toLocaleString()}
                </span>
              )}
            </div>

            {/* Outbound Message */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Outbound Message
              </div>
              {previewLead.subject && (
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--foreground)' }}>
                  Subject: {previewLead.subject}
                </div>
              )}
              <pre style={{
                fontSize: '0.825rem',
                whiteSpace: 'pre-wrap',
                background: 'rgba(0,0,0,0.03)',
                padding: '0.85rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                maxHeight: '180px',
                overflowY: 'auto',
                fontFamily: 'inherit',
                margin: 0,
                color: 'var(--foreground)'
              }}>
                {previewLead.body || 'Email body sent to recipient.'}
              </pre>
            </div>

            {/* Inbound Response */}
            {previewLead.response ? (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase' }}>
                    Client Inbound Reply
                  </div>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                    background: '#dbeafe',
                    color: '#1e40af'
                  }}>
                    INTENT: {previewLead.response.intent || 'REPLY'}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                  background: 'rgba(16, 185, 129, 0.05)',
                  padding: '0.85rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  color: 'var(--foreground)'
                }}>
                  {previewLead.response.message || previewLead.response.snippet || 'Client responded to this campaign.'}
                </div>
              </div>
            ) : (
              <div style={{
                fontSize: '0.825rem',
                color: 'var(--muted-foreground)',
                padding: '0.75rem',
                borderRadius: '6px',
                background: 'var(--muted)',
                marginBottom: '1.25rem'
              }}>
                ℹ️ No reply from this recipient has been detected yet. Background polling automatically scans inbox.
              </div>
            )}

            {/* Follow-up cadence status */}
            {previewLead.follow_up_delay && previewLead.follow_up_delay > 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', marginBottom: '1rem' }}>
                ⏰ Follow-up Cadence: {previewLead.follow_up_delay}h delay {previewLead.follow_up_sent ? '(✓ Already Sent)' : '(Scheduled if no reply)'}
              </div>
            ) : null}

            <div style={{ textAlign: 'right', marginTop: '1rem' }}>
              <button 
                className="btn"
                onClick={() => setPreviewLead(null)}
                style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CampaignDashboard() {
  return (
    <Suspense fallback={
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
        Loading Campaign Intelligence...
      </div>
    }>
      <CampaignDashboardContent />
    </Suspense>
  );
}
