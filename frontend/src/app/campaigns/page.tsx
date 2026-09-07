'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function CampaignsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [selectedSenderAccounts, setSelectedSenderAccounts] = useState<string[]>([]);
  const [leadPromptModal, setLeadPromptModal] = useState<'no_leads' | 'none_selected' | null>(null);
  const [highlightLeadsPanel, setHighlightLeadsPanel] = useState(false);
  
  // Multi-Account Sender Dispatch State
  const [dispatchMode, setDispatchMode] = useState<'single' | 'multi_account'>('multi_account');
  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string>('');
  
  // Main Email State
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  
  // Personalization Preview & Focus Tracking
  const [activeField, setActiveField] = useState<'subject' | 'body' | 'followUpBody'>('body');
  const [showPreview, setShowPreview] = useState(false);
  const [previewLeadId, setPreviewLeadId] = useState<string>('');
  
  // Follow-up State
  const [followUpDelay, setFollowUpDelay] = useState(0); // 0 means no follow-up, -1 means custom
  const [customDelayValue, setCustomDelayValue] = useState(2);
  const [customDelayType, setCustomDelayType] = useState('hours');
  const [isCustomFollowUp, setIsCustomFollowUp] = useState(false);
  const [followUpBody, setFollowUpBody] = useState('');
  const [aiFollowUpPrompt, setAiFollowUpPrompt] = useState('');
  
  // Auto-Reply Logic State
  const [autoReplyPrompt, setAutoReplyPrompt] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);

  const [loadingLeads, setLoadingLeads] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingFollowUp, setGeneratingFollowUp] = useState(false);
  const [sending, setSending] = useState(false);
  const [connectingAccount, setConnectingAccount] = useState(false);

  // Custom Delay Between Sends (Email #1 sends initially; subsequent emails wait desired delay)
  const [delayBetweenEmails, setDelayBetweenEmails] = useState<number>(10);

  useEffect(() => {
    const init = async () => {
      try {
        const [userData, leadsData, accountsData] = await Promise.all([
          api.getMe().catch(() => ({ email: 'umairsahib242@gmail.com', name: 'Sir Umair' })),
          api.getLeads().catch(() => []),
          api.getConnectedAccounts().catch(() => ({ accounts: [] }))
        ]);
        setUser(userData);
        const validLeads = Array.isArray(leadsData) ? leadsData : [];
        setLeads(validLeads);
        const accts = accountsData?.accounts || [];
        setAccounts(accts);
        setSelectedSenderAccounts(accts.map((a: any) => a.email));
        if (userData?.email) setSelectedSenderEmail(userData.email);
        if (validLeads.length > 0) setPreviewLeadId(validLeads[0].id);
      } catch (err) {
        console.error("Init Error:", err);
      } finally {
        setLoadingLeads(false);
      }
    };
    init();
  }, []);

  const handleConnectNewAccount = async () => {
    try {
      setConnectingAccount(true);
      const res = await api.login();
      if (res.auth_url) {
        window.location.href = res.auth_url;
      }
    } catch (err: any) {
      alert('Failed to connect new account: ' + err.message);
      setConnectingAccount(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedEmails.length === leads.length) {
      setSelectedEmails([]);
    } else {
      setSelectedEmails(leads.map(l => l.email));
    }
  };

  const toggleSelectLead = (email: string) => {
    if (selectedEmails.includes(email)) {
      setSelectedEmails(selectedEmails.filter(e => e !== email));
    } else {
      setSelectedEmails([...selectedEmails, email]);
    }
  };

  const toggleSenderAccount = (email: string) => {
    if (selectedSenderAccounts.includes(email)) {
      if (selectedSenderAccounts.length === 1) return alert('At least one sender account must be selected.');
      setSelectedSenderAccounts(selectedSenderAccounts.filter(e => e !== email));
    } else {
      setSelectedSenderAccounts([...selectedSenderAccounts, email]);
    }
  };

  const insertTag = (tag: string) => {
    if (activeField === 'subject') {
      setSubject(prev => prev + tag);
    } else if (activeField === 'followUpBody') {
      setFollowUpBody(prev => prev + tag);
    } else {
      setBody(prev => prev + tag);
    }
  };

  const getPersonalizedPreview = (text: string) => {
    const lead = leads.find(l => l.id === previewLeadId) || leads[0];
    if (!lead) return text;
    const name = lead.name || lead.email.split('@')[0];
    const firstName = name.split(' ')[0];
    const company = lead.company || 'Acme Inc';
    const notes = lead.notes || '';

    return text
      .replace(/(\{name\}|\\name|\[name\]|\{\{name\}\}|\$name)/gi, name)
      .replace(/(\{first_name\}|\\first_name|\{firstname\}|\\firstname|\$first_name|\$firstname)/gi, firstName)
      .replace(/(\{company\}|\\company|\[company\]|\$company)/gi, company)
      .replace(/(\{email\}|\\email|\[email\]|\$email)/gi, lead.email)
      .replace(/(\{notes\}|\\notes|\[notes\]|\$notes)/gi, notes);
  };

  const executeGenerateAI = async (leadsToUse: any[], isGeneric: boolean = false) => {
    try {
      setGenerating(true);
      const sampleLeads = isGeneric ? [] : leadsToUse.slice(0, 5).map(l => ({
        name: l.name,
        company: l.company,
        notes: l.notes,
        email: l.email
      }));
      const res = await api.generateEmailContent(aiPrompt, sampleLeads);
      setBody(res.generated_content);
      if (!subject) {
        setSubject(isGeneric ? 'Quick question regarding our services' : 'Quick question for {first_name} re: {company}');
      }
      if (!isGeneric && leadsToUse.length > 0) {
        setPreviewLeadId(leadsToUse[0].id);
        setShowPreview(true);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to generate AI content');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) return alert('Please enter what you are offering in the AI prompt box first.');

    // Check 1: No leads added yet in system
    if (leads.length === 0) {
      setLeadPromptModal('no_leads');
      return;
    }

    // Check 2: Leads exist, but none are selected
    if (selectedEmails.length === 0) {
      setLeadPromptModal('none_selected');
      return;
    }

    const activeLeads = leads.filter(l => selectedEmails.includes(l.email));
    await executeGenerateAI(activeLeads, false);
  };

  const handleSelectAllAndGenerate = async () => {
    const allEmails = leads.map(l => l.email);
    setSelectedEmails(allEmails);
    setLeadPromptModal(null);
    await executeGenerateAI(leads, false);
  };

  const handleChooseLeadsManually = () => {
    setLeadPromptModal(null);
    setHighlightLeadsPanel(true);
    const leadsEl = document.getElementById('campaign-leads-selector');
    if (leadsEl) {
      leadsEl.scrollIntoView({ behavior: 'smooth' });
    }
    setTimeout(() => setHighlightLeadsPanel(false), 3500);
  };

  const handleGenerateGenericAnyway = async () => {
    setLeadPromptModal(null);
    await executeGenerateAI([], true);
  };

  const handleGenerateFollowUp = async () => {
    if (!subject || !body) return alert('Please construct an original Subject and Body first.');
    try {
      setGeneratingFollowUp(true);
      let res;
      if (aiFollowUpPrompt) {
        res = await api.generateFollowupFromPrompt({
          prompt: aiFollowUpPrompt,
          original_subject: subject,
          original_body: body
        });
      } else {
        res = await api.generateFollowupContent(subject, body);
      }
      setFollowUpBody(res.generated_content);
      setIsCustomFollowUp(true);
    } catch (err: any) {
      alert(err.message || 'Failed to generate AI follow up content');
    } finally {
      setGeneratingFollowUp(false);
    }
  };

  const handleFetchSuggestions = async () => {
    if (!subject || !body) return alert('Please draft the main email first to get relevant suggestions.');
    try {
      setFetchingSuggestions(true);
      const res = await api.getAutoReplySuggestions(subject, body);
      setSuggestions(res.suggestions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setFetchingSuggestions(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type !== "application/pdf") {
        alert("Only PDF files are supported format at this time.");
        e.target.value = '';
        return;
      }
      setAttachment(file);
    }
  };

  const handleSendCampaign = async () => {
    if (selectedEmails.length === 0) return alert('Please select at least one lead');
    if (!subject || !body) return alert('Subject and Body are required');
    
    try {
      setSending(true);
      const finalDelay = followUpDelay === -1 
        ? (customDelayType === 'days' ? customDelayValue * 1440 : customDelayType === 'hours' ? customDelayValue * 60 : customDelayValue) 
        : followUpDelay;

      const sender_emails = dispatchMode === 'multi_account' && selectedSenderAccounts.length > 0
        ? selectedSenderAccounts
        : (selectedSenderEmail ? [selectedSenderEmail] : (user?.email ? [user.email] : undefined));

      const result = await api.sendBulkEmails({
        emails: selectedEmails,
        subject,
        body,
        sender_emails,
        attachment,
        follow_up_delay: finalDelay,
        follow_up_body: isCustomFollowUp ? followUpBody : undefined,
        auto_reply_prompt: autoReplyPrompt || undefined,
        delay_seconds: delayBetweenEmails,
        min_send_delay: delayBetweenEmails,
        max_send_delay: delayBetweenEmails,
        enable_human_pauses: false,
        test_mode: false
      });

      if (result.is_background || result.status === 'queued') {
        alert(`🚀 Campaign Launched!\n\nEmail #1 was sent initially.\nSubsequent emails are sending with your custom delay of ${delayBetweenEmails}s in between.\nEstimated duration: ~${result.estimated_minutes || 1} min.\n\nYou can navigate away safely; live progress is tracking in real time.`);
        setSubject('');
        setBody('');
        setFollowUpBody('');
        setFollowUpDelay(0);
        setIsCustomFollowUp(false);
        setAttachment(null);
        setSelectedEmails([]);
      } else if (result.failed === 0) {
        alert(`🚀 Campaign complete! Successfully sent to all ${result.successful} leads using ${result.senders_used ? result.senders_used.length : 1} sender account(s).`);
        setSubject('');
        setBody('');
        setFollowUpBody('');
        setFollowUpDelay(0);
        setIsCustomFollowUp(false);
        setAttachment(null);
        setSelectedEmails([]);
      } else {
        alert(`⚠️ Campaign Dispatch Status:\n✅ Successful: ${result.successful}\n❌ Failed: ${result.failed}\n${result.error ? '\nDetails: ' + result.error : ''}`);
      }
    } catch (err: any) {
      alert(`❌ Campaign Failed:\n\n${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.25rem', marginBottom: '0.5rem', background: 'linear-gradient(to right, #6366f1, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          AI Campaign Architect
        </h1>
        <p style={{ fontSize: '1.05rem' }}>Design high-conversion cold email campaigns with Multi-Account Dispatching & Personalized Lead Variables.</p>
      </div>

      <div className="responsive-split">
        {/* Main Workspace */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Multi-Account Sender Dispatch Section */}
          <section className="card" style={{ borderLeft: '4px solid #3b82f6', background: '#eff6ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ background: '#3b82f6', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 'bold' }}>✉️</span>
                <h3 style={{ margin: 0, color: '#1e3a8a' }}>Multi-Account Gmail Dispatcher</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={handleConnectNewAccount}
                  disabled={connectingAccount}
                  style={{
                    background: '#2563eb',
                    color: 'white',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {connectingAccount ? 'Connecting...' : '➕ Connect Gmail Account'}
                </button>
              </div>
            </div>

            <p style={{ fontSize: '0.875rem', color: '#1e40af', marginBottom: '1rem' }}>
              Distribute campaign emails across multiple connected Gmail accounts to protect domain reputation and maximize inbox deliverability.
            </p>

            <div className="grid-2col" style={{ marginBottom: '1rem' }}>
              <label 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.75rem', 
                  padding: '0.875rem 1rem', 
                  borderRadius: '8px', 
                  background: dispatchMode === 'multi_account' ? '#dbeafe' : 'white', 
                  border: dispatchMode === 'multi_account' ? '2px solid #3b82f6' : '1px solid #cbd5e1', 
                  cursor: 'pointer'
                }}
              >
                <input 
                  type="radio" 
                  name="dispatch_mode" 
                  checked={dispatchMode === 'multi_account'}
                  onChange={() => setDispatchMode('multi_account')}
                  style={{ width: '18px', height: '18px' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e3a8a' }}>🔄 Multi-Mail Round Robin</div>
                  <div style={{ fontSize: '0.75rem', color: '#3b82f6' }}>Rotate sends across all selected accounts</div>
                </div>
              </label>

              <label 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.75rem', 
                  padding: '0.875rem 1rem', 
                  borderRadius: '8px', 
                  background: dispatchMode === 'single' ? '#dbeafe' : 'white', 
                  border: dispatchMode === 'single' ? '2px solid #3b82f6' : '1px solid #cbd5e1', 
                  cursor: 'pointer'
                }}
              >
                <input 
                  type="radio" 
                  name="dispatch_mode" 
                  checked={dispatchMode === 'single'}
                  onChange={() => setDispatchMode('single')}
                  style={{ width: '18px', height: '18px' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e3a8a' }}>👤 Single Account Only</div>
                  <div style={{ fontSize: '0.75rem', color: '#3b82f6' }}>Send entire batch from 1 selected account</div>
                </div>
              </label>
            </div>

            {dispatchMode === 'multi_account' && (
              <div style={{ background: 'white', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                <label className="label" style={{ color: '#1e3a8a', marginBottom: '0.5rem' }}>Connected Accounts in Rotation ({selectedSenderAccounts.length}/{accounts.length || 1})</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {accounts.length > 0 ? (
                    accounts.map(acc => {
                      const isSelected = selectedSenderAccounts.includes(acc.email);
                      const isExpired = acc.auth_status === 'expired';
                      return (
                        <button
                          key={acc.id}
                          onClick={() => toggleSenderAccount(acc.email)}
                          style={{
                            padding: '0.4rem 0.8rem',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            background: isSelected ? '#eff6ff' : '#f8fafc',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid #cbd5e1',
                            color: isSelected ? '#1d4ed8' : '#64748b'
                          }}
                        >
                          <span>{isSelected ? '☑' : '☐'}</span>
                          <span>{acc.email}</span>
                          {isExpired ? (
                            <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Reconnect</span>
                          ) : (
                            <span style={{ background: '#dcfce7', color: '#166534', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Active</span>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: '0.875rem', color: '#1e40af' }}>{user?.email || 'Default Account'} (Active)</span>
                  )}
                </div>
              </div>
            )}

            {dispatchMode === 'single' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label className="label" style={{ color: '#1e3a8a' }}>Select Sender Account</label>
                <select 
                  className="input"
                  value={selectedSenderEmail}
                  onChange={e => setSelectedSenderEmail(e.target.value)}
                  style={{ background: 'white' }}
                >
                  {accounts.length > 0 ? (
                    accounts.map(acc => (
                      <option key={acc.id} value={acc.email}>
                        {acc.name ? `${acc.name} (${acc.email})` : acc.email} {acc.auth_status === 'expired' ? ' (Expired - Needs Reconnect)' : ''}
                      </option>
                    ))
                  ) : (
                    <option value={user?.email || ''}>{user?.email || 'Default Account'}</option>
                  )}
                </select>
              </div>
            )}
          </section>
          
          {/* Step 1: AI Content Generation */}
          <section className="card" style={{ borderLeft: '4px solid #6366f1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <span style={{ background: '#6366f1', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 'bold' }}>1</span>
              <h3 style={{ margin: 0 }}>AI Content Assistant</h3>
            </div>
            
            <div className="form-group">
              {/* Dynamic Lead Personalization Indicator */}
              {leads.length === 0 ? (
                <div style={{ padding: '0.625rem 0.875rem', background: '#fef3c7', border: '1px solid #fde047', borderRadius: '8px', color: '#854d0e', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span>⚠️ <strong>0 leads in database</strong>. Add leads first to enable personalized emails with prospect names and companies.</span>
                  <Link href="/leads" style={{ color: '#1d4ed8', fontWeight: 700, textDecoration: 'underline' }}>Go to Leads Page →</Link>
                </div>
              ) : selectedEmails.length === 0 ? (
                <div style={{ padding: '0.625rem 0.875rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1e40af', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span>👥 <strong>{leads.length} lead(s) available</strong>, but none selected yet. Please select leads on the right to personalize outreach.</span>
                  <button onClick={toggleSelectAll} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: '5px', padding: '0.3rem 0.65rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>⚡ Select All ({leads.length})</button>
                </div>
              ) : (
                <div style={{ padding: '0.625rem 0.875rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span>🎯 <strong>Personalization Active</strong> for <strong>{selectedEmails.length}</strong> selected lead(s) using <code>&#123;name&#125;</code> and <code>&#123;company&#125;</code> tags.</span>
                  <span style={{ fontSize: '0.75rem', background: '#dcfce7', color: '#15803d', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>Ready</span>
                </div>
              )}

              <label className="label">What are you offering? (AI Prompt)</label>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input 
                  className="input" 
                  style={{ flex: 1, minWidth: '200px' }}
                  placeholder="Ex: Reach out to tech founders about our new AI Marketing Audit..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                />
                <button 
                  className="btn" 
                  style={{ minWidth: '120px', background: 'linear-gradient(45deg, #6366f1, #4f46e5)' }}
                  onClick={handleGenerateAI}
                  disabled={generating}
                >
                  {generating ? '✨ Magic...' : '✨ Generate'}
                </button>
              </div>
            </div>
          </section>

          {/* Step 2: Main Email Composition & Personalization Toolbar */}
          <section className="card" style={{ borderLeft: '4px solid #10b981' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ background: '#10b981', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 'bold' }}>2</span>
                <h3 style={{ margin: 0 }}>Main Email Outreach</h3>
              </div>
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={{
                  background: showPreview ? '#ecfdf5' : 'white',
                  border: '1px solid #10b981',
                  color: '#047857',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {showPreview ? '✏️ Edit Draft' : '👁️ Live Personalization Preview'}
              </button>
            </div>

            {/* Personalization Tag Toolbar */}
            <div style={{ background: '#f0fdf4', padding: '0.875rem 1rem', borderRadius: '8px', border: '1px solid #bbf7d0', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#166534', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🏷️ Personalized Variable Tags (Click to insert into active field):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {[
                  { tag: '{name}', label: 'Full Name' },
                  { tag: '{first_name}', label: 'First Name' },
                  { tag: '{company}', label: 'Company Name' },
                  { tag: '{email}', label: 'Email' },
                  { tag: '{notes}', label: 'Custom Notes' }
                ].map(item => (
                  <button
                    key={item.tag}
                    onClick={() => insertTag(item.tag)}
                    style={{
                      background: 'white',
                      border: '1px solid #86efac',
                      color: '#15803d',
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    title={`Insert ${item.tag} tag`}
                  >
                    + {item.tag} <span style={{ color: '#65a30d', fontWeight: 400 }}>({item.label})</span>
                  </button>
                ))}
              </div>
            </div>

            {showPreview ? (
              /* Live Personalization Preview Box */
              <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#334155' }}>
                    Previewing personalized mail for recipient:
                  </span>
                  <select
                    className="input"
                    style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                    value={previewLeadId}
                    onChange={e => setPreviewLeadId(e.target.value)}
                  >
                    {leads.map(l => (
                      <option key={l.id} value={l.id}>{l.name ? `${l.name} (${l.email})` : l.email}</option>
                    ))}
                  </select>
                </div>
                <div style={{ background: 'white', padding: '1rem', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
                    <strong>Subject:</strong> {getPersonalizedPreview(subject) || '(No Subject)'}
                  </div>
                  <hr style={{ border: 'none', borderTop: '1px dashed #e2e8f0', margin: '0.5rem 0' }} />
                  <div style={{ fontSize: '0.9rem', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {getPersonalizedPreview(body) || '(No Body Content)'}
                  </div>
                </div>
              </div>
            ) : (
              /* Composition Form */
              <>
                <div className="form-group">
                  <label className="label">Subject Line</label>
                  <input 
                    className="input" 
                    placeholder="Ex: Quick question about {company}..." 
                    value={subject}
                    onFocus={() => setActiveField('subject')}
                    onChange={e => setSubject(e.target.value)}
                  />
                </div>
                
                <div className="form-group">
                  <label className="label">Message Body</label>
                  <textarea 
                    className="input" 
                    rows={9} 
                    style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.6' }}
                    placeholder="Draft your email. Use {name} or {first_name} for personalized greeting..."
                    value={body}
                    onFocus={() => setActiveField('body')}
                    onChange={e => setBody(e.target.value)}
                  ></textarea>
                </div>
              </>
            )}

            <div className="form-group">
              <label className="label">PDF Attachment (Trust Builder)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem', border: '2px dashed var(--border)', borderRadius: 'var(--radius)', background: '#f8fafc', flexWrap: 'wrap' }}>
                <input 
                  type="file" 
                  accept=".pdf" 
                  onChange={handleFileChange} 
                  style={{ fontSize: '0.875rem' }}
                />
                {attachment && <span style={{ color: '#10b981', fontWeight: 500 }}>✓ {attachment.name}</span>}
              </div>
            </div>
          </section>

          {/* Step 3: Follow-up Strategy */}
          <section className="card" style={{ borderLeft: '4px solid #f59e0b', background: '#fffbeb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <span style={{ background: '#f59e0b', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 'bold' }}>3</span>
              <h3 style={{ margin: 0 }}>Automated Follow-up Strategy</h3>
            </div>

            <div className="grid-2col">
              <div className="form-group">
                <label className="label">Trigger Condition</label>
                <select 
                  className="input" 
                  value={followUpDelay === -1 && customDelayValue === 0 ? 0 : followUpDelay} 
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setFollowUpDelay(val);
                    if (val === 0) setIsCustomFollowUp(false);
                  }}
                >
                  <option value={0}>No automatic follow-up</option>
                  <option value={1}>If no reply after 1 minute (Test Mode)</option>
                  <option value={60}>If no reply after 1 hour</option>
                  <option value={1440}>If no reply after 24 hours</option>
                  <option value={2880}>If no reply after 48 hours</option>
                  <option value={4320}>If no reply after 72 hours</option>
                  <option value={-1}>Custom Time Delay...</option>
                </select>

                {followUpDelay === -1 && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input 
                      type="number" 
                      className="input" 
                      min="1"
                      placeholder="Amt"
                      value={customDelayValue || ''}
                      onChange={e => setCustomDelayValue(parseInt(e.target.value) || 0)}
                      style={{ width: '80px' }}
                    />
                    <select 
                      className="input" 
                      value={customDelayType}
                      onChange={e => setCustomDelayType(e.target.value)}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                )}
              </div>

              {(followUpDelay > 0 || followUpDelay === -1) && (
                <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.75rem', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', width: '100%' }}>
                    <input 
                      type="checkbox" 
                      checked={isCustomFollowUp}
                      onChange={e => setIsCustomFollowUp(e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Customize follow-up mail?</span>
                  </label>
                </div>
              )}
            </div>

            {isCustomFollowUp && (
              <div style={{ marginTop: '1rem' }}>
                <div className="form-group">
                  <label className="label">Follow-up AI Assistant (Optional Prompt)</label>
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <input 
                      className="input" 
                      style={{ flex: 1, minWidth: '200px' }}
                      placeholder="Ex: Keep it short, ask if {first_name} has 5 mins for a call..."
                      value={aiFollowUpPrompt}
                      onChange={e => setAiFollowUpPrompt(e.target.value)}
                    />
                    <button 
                      className="btn btn-secondary" 
                      style={{ minWidth: '120px' }}
                      onClick={handleGenerateFollowUp}
                      disabled={generatingFollowUp}
                    >
                      {generatingFollowUp ? '✨ Magic...' : '🪄 Generate'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="label" style={{ margin: 0 }}>Custom Follow-up Content</label>
                  {!aiFollowUpPrompt && (
                    <button 
                      className="btn btn-secondary" 
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                      onClick={handleGenerateFollowUp}
                      disabled={generatingFollowUp}
                    >
                      {generatingFollowUp ? 'Generating...' : '🪄 Auto-Nudge (Based on Original)'}
                    </button>
                  )}
                </div>
                <textarea 
                  className="input" 
                  rows={5} 
                  placeholder="The 'gentle nudge' message... Supports {name}, {company}, etc."
                  value={followUpBody}
                  onFocus={() => setActiveField('followUpBody')}
                  onChange={e => setFollowUpBody(e.target.value)}
                ></textarea>
              </div>
            )}
          </section>

          {/* Step 4: Adaptive Auto-Responder */}
          <section className="card" style={{ borderLeft: '4px solid #8b5cf6', background: '#f5f3ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <span style={{ background: '#8b5cf6', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 'bold' }}>4</span>
              <h3 style={{ margin: 0 }}>Adaptive Auto-Responder</h3>
            </div>

            <div className="form-group">
              <label className="label">Inbound Reply Strategy</label>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.75rem' }}>Tell the AI exactly how to respond when a lead replies to this campaign.</p>
              
              <textarea 
                className="input" 
                rows={3} 
                placeholder="Ex: Be very aggressive on booking a call, or 'Answer questions about pricing then offer a demo'..."
                value={autoReplyPrompt}
                onChange={e => setAutoReplyPrompt(e.target.value)}
                style={{ marginBottom: '1rem' }}
              ></textarea>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button 
                  className="btn btn-outline" 
                  style={{ width: 'fit-content', fontSize: '0.85rem' }}
                  onClick={handleFetchSuggestions}
                  disabled={fetchingSuggestions}
                >
                  {fetchingSuggestions ? 'Thinking...' : '💡 Get Strategy Suggestions'}
                </button>

                {suggestions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
                    {suggestions.map((s, i) => (
                      <button 
                        key={i}
                        onClick={() => setAutoReplyPrompt(s)}
                        style={{ padding: '0.4rem 0.8rem', background: 'white', border: '1px solid #ddd6fe', borderRadius: '999px', fontSize: '0.75rem', cursor: 'pointer' }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Step 5: Custom Sending Delays */}
          <section className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ background: 'var(--primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 'bold' }}>5</span>
                <div>
                  <h3 style={{ margin: 0 }}>Custom Delay Between Sends</h3>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                    Email #1 sends initially (immediate). Subsequent emails wait your desired custom delay in between.
                  </p>
                </div>
              </div>
              <span style={{ 
                background: delayBetweenEmails === 0 ? 'var(--muted)' : '#dcfce7', 
                color: delayBetweenEmails === 0 ? 'var(--muted-foreground)' : '#15803d', 
                padding: '0.25rem 0.65rem', 
                borderRadius: '999px', 
                fontSize: '0.75rem', 
                fontWeight: 700,
                border: delayBetweenEmails === 0 ? '1px solid var(--border)' : '1px solid #86efac'
              }}>
                {delayBetweenEmails === 0 ? '⚡ Instant (No delay)' : `⏱️ ${delayBetweenEmails}s Delay Active`}
              </span>
            </div>

            <div className="form-group">
              <label className="label" style={{ marginBottom: '0.6rem', display: 'block' }}>
                Desired Delay Between Each Email:
              </label>

              {/* Quick Select Presets */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {[
                  { label: '⚡ 0s (Instant)', val: 0 },
                  { label: '5 sec', val: 5 },
                  { label: '10 sec', val: 10 },
                  { label: '15 sec', val: 15 },
                  { label: '30 sec', val: 30 },
                  { label: '60 sec (1 min)', val: 60 },
                  { label: '120 sec (2 min)', val: 120 }
                ].map((preset) => (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() => setDelayBetweenEmails(preset.val)}
                    style={{
                      padding: '0.5rem 0.9rem',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: delayBetweenEmails === preset.val ? 'var(--primary)' : 'var(--border)',
                      background: delayBetweenEmails === preset.val ? 'rgba(99, 102, 241, 0.12)' : 'var(--card)',
                      color: delayBetweenEmails === preset.val ? 'var(--primary)' : 'var(--foreground)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Custom Number Input */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.75rem', 
                background: 'var(--card)', 
                padding: '0.85rem 1rem', 
                borderRadius: '8px', 
                border: '1px solid var(--border)',
                marginBottom: '1rem',
                flexWrap: 'wrap'
              }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)' }}>
                  Enter Desired Seconds:
                </span>
                <input 
                  type="number" 
                  className="input" 
                  min="0" 
                  max="3600"
                  value={delayBetweenEmails} 
                  onChange={e => setDelayBetweenEmails(Math.max(0, parseInt(e.target.value) || 0))}
                  style={{ width: '100px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                />
                <span style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
                  seconds delay between each subsequent email send
                </span>
              </div>

              {/* Dispatch Timeline Summary */}
              <div style={{ 
                background: 'rgba(99, 102, 241, 0.05)', 
                border: '1px solid rgba(99, 102, 241, 0.2)', 
                borderRadius: '8px', 
                padding: '0.85rem 1rem', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                flexWrap: 'wrap', 
                gap: '0.75rem' 
              }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--foreground)' }}>
                  <strong>🚀 Dispatch Sequence:</strong> Email #1 sends initially. Each following email waits {delayBetweenEmails}s before sending.
                </div>
                <div style={{ fontSize: '0.825rem', color: 'var(--primary)', fontWeight: 600 }}>
                  ⏱️ Estimated Duration: ~{
                    selectedEmails.length <= 1 
                      ? 'Instant (1 email)' 
                      : `${Math.max(0.1, Math.round(((selectedEmails.length - 1) * delayBetweenEmails) / 60 * 10) / 10)} min for ${selectedEmails.length} recipients`
                  }
                </div>
              </div>
            </div>
          </section>

          <button 
            className="btn" 
            style={{ width: '100%', padding: '1.25rem', fontSize: '1.125rem', boxShadow: '0 4px 14px 0 rgba(99, 102, 241, 0.39)' }}
            onClick={handleSendCampaign}
            disabled={sending || selectedEmails.length === 0}
          >
            {sending ? '🚀 Launching Campaign...' : `🚀 Launch Personalized Campaign to ${selectedEmails.length} Lead(s)`}
          </button>
        </div>

        {/* Lead Selection Sidebar */}
        <aside>
          <div 
            id="campaign-leads-selector"
            className="card" 
            style={{ 
              height: 'fit-content', 
              position: 'sticky', 
              top: '2rem',
              transition: 'all 0.3s ease',
              boxShadow: highlightLeadsPanel ? '0 0 0 4px #6366f1, 0 10px 25px -5px rgba(99, 102, 241, 0.4)' : undefined,
              borderColor: highlightLeadsPanel ? '#6366f1' : undefined
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Target Audience</h3>
              <Link href="/leads" style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>Manage Leads →</Link>
            </div>

            <div style={{ padding: '0.75rem', background: '#f0f9ff', borderRadius: '6px', border: '1px solid #bae6fd', marginBottom: '1.25rem', fontSize: '0.875rem', color: '#0369a1' }}>
              Selected: <strong>{selectedEmails.length}</strong> / {leads.length} leads
            </div>
            
            <button 
              className="btn btn-outline" 
              style={{ width: '100%', marginBottom: '1.25rem', fontWeight: 600 }}
              onClick={toggleSelectAll}
              disabled={leads.length === 0}
            >
              {selectedEmails.length === leads.length && leads.length > 0 ? 'Deselect All' : 'Select All Leads'}
            </button>

            <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
              {loadingLeads ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>Loading leads...</div>
              ) : !Array.isArray(leads) || leads.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted-foreground)' }}>
                  <p style={{ marginBottom: '1rem' }}>No leads found in database.</p>
                  <Link href="/leads" className="btn" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', background: '#2563eb' }}>
                    ➕ Add Leads
                  </Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {leads.map(lead => (
                    <label 
                      key={lead.id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        padding: '0.625rem 0.75rem', 
                        borderRadius: '8px',
                        background: selectedEmails.includes(lead.email) ? '#f5f3ff' : 'transparent',
                        border: selectedEmails.includes(lead.email) ? '1px solid #ddd6fe' : '1px solid transparent',
                        cursor: 'pointer'
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={selectedEmails.includes(lead.email)}
                        onChange={() => toggleSelectLead(lead.email)}
                        style={{ marginRight: '0.75rem', width: '16px', height: '16px' }}
                      />
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{lead.name || 'N/A'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {lead.email} {lead.company ? `(${lead.company})` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Modal: No Leads in Database */}
      {leadPromptModal === 'no_leads' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '100%',
            padding: '2rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
            animation: 'slideIn 0.2s ease-out'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#fef3c7', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.2rem' }}>Add Leads for Personalization</h3>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>No leads found in your database</span>
              </div>
            </div>

            <p style={{ color: '#334155', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              To generate personalized emails tailored with prospect names (<code>&#123;first_name&#125;</code>), companies (<code>&#123;company&#125;</code>), and custom notes, you need to add or import leads first.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                className="btn"
                onClick={() => router.push('/leads')}
                style={{ background: '#2563eb', color: 'white', padding: '0.75rem 1.25rem', fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                <span>🚀 Go to Leads Page & Add Leads</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleGenerateGenericAnyway}
                style={{ padding: '0.65rem 1.25rem', fontSize: '0.85rem' }}
              >
                Generate Generic Template Without Leads
              </button>

              <button
                onClick={() => setLeadPromptModal(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', padding: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Leads exist but none selected */}
      {leadPromptModal === 'none_selected' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            maxWidth: '520px',
            width: '100%',
            padding: '2rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
            animation: 'slideIn 0.2s ease-out'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                👥
              </div>
              <div>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.2rem' }}>Select Target Leads</h3>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{leads.length} lead(s) available in your database</span>
              </div>
            </div>

            <p style={{ color: '#334155', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              You haven't selected any leads yet! Please select which prospects you are targeting so AI can tailor the personalized email with their names (<code>&#123;name&#125;</code>) and companies (<code>&#123;company&#125;</code>).
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                className="btn"
                onClick={handleSelectAllAndGenerate}
                style={{ background: 'linear-gradient(45deg, #2563eb, #4f46e5)', color: 'white', padding: '0.75rem 1.25rem', fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                <span>⚡ Select All {leads.length} Leads & Generate</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleChooseLeadsManually}
                style={{ padding: '0.65rem 1.25rem', fontSize: '0.85rem' }}
              >
                👈 I Will Select Leads From List First
              </button>

              <button
                onClick={() => setLeadPromptModal(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', padding: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
