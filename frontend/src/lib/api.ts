const getApiBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    // In Windows / modern browsers, using 127.0.0.1 avoids IPv6 ::1 connection refused on localhost
    return 'http://127.0.0.1:8000';
  }
  return 'http://127.0.0.1:8000';
};

const getHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
};

async function safeFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    return await fetch(url, options);
  } catch (err: any) {
    // If failed, automatically fallback between 127.0.0.1 and localhost
    const altUrl = url.includes('127.0.0.1:8000')
      ? url.replace('127.0.0.1:8000', 'localhost:8000')
      : url.replace('localhost:8000', '127.0.0.1:8000');
    try {
      return await fetch(altUrl, options);
    } catch (fallbackErr: any) {
      throw new Error(`Unable to connect to backend at ${url}. Please ensure the FastAPI server is running on port 8000.`);
    }
  }
}

export const api = {
  // Auth
  async login() {
    const response = await safeFetch('/api/auth/login');
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to initiate login');
    }
    return response.json();
  },

  async exchangeAuthCode(code: string, state?: string | null, redirectUri?: string | null) {
    let response: Response;
    try {
      response = await safeFetch('/api/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
      });
    } catch {
      const params = new URLSearchParams({ code, format: 'json' });
      if (state) params.set('state', state);
      if (redirectUri) params.set('redirect_uri', redirectUri);
      response = await safeFetch(`/api/auth/callback?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
      });
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Token exchange failed');
    }
    const data = await response.json();
    if (data.token && typeof window !== 'undefined') {
      localStorage.setItem('auth_token', data.token);
      if (data.email) localStorage.setItem('user_email', data.email);
    }
    return data;
  },

  async directLogin(email?: string) {
    const response = await safeFetch('/api/auth/direct-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || '' }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to login to workspace');
    }
    const data = await response.json();
    if (data.token && typeof window !== 'undefined') {
      localStorage.setItem('auth_token', data.token);
      if (data.email) localStorage.setItem('user_email', data.email);
    }
    return data;
  },

  async getMe() {
    const response = await safeFetch('/api/auth/me', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch user info');
    }
    const data = await response.json();
    if (data.token && typeof window !== 'undefined') {
      localStorage.setItem('auth_token', data.token);
    }
    return data;
  },

  async getConnectedAccounts() {
    const response = await safeFetch('/api/auth/accounts', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch connected accounts');
    }
    return response.json();
  },

  async disconnectAccount(email: string) {
    const response = await safeFetch(`/api/auth/accounts/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to disconnect account');
    }
    return response.json();
  },

  // Leads
  async getLeads() {
    const response = await safeFetch('/leads/', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch leads');
    }
    return response.json();
  },

  async createLead(lead: { name: string; email: string; company?: string; notes?: string }) {
    const response = await safeFetch('/leads/', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(lead),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create lead');
    }
    return response.json();
  },

  async importLeadsFromSheetUrl(sheet_url: string) {
    const response = await safeFetch('/leads/import-sheet-url', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ sheet_url }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to import leads from Google Sheet URL');
    }
    return response.json();
  },

  async importLeadsFromFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const response = await safeFetch('/leads/import-file', {
      method: 'POST',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to import leads from file');
    }
    return response.json();
  },

  async deleteLead(id: string) {
    const response = await safeFetch(`/leads/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete lead');
    }
    return true;
  },

  // Emails
  async sendBulkEmails(data: { 
    emails: string[], 
    subject: string, 
    body: string, 
    sender_emails?: string[],
    attachment?: File | null,
    follow_up_delay: number,
    follow_up_body?: string,
    auto_reply_prompt?: string,
    delay_seconds?: number,
    min_send_delay?: number,
    max_send_delay?: number,
    enable_human_pauses?: boolean,
    test_mode?: boolean
  }) {
    const formData = new FormData();
    formData.append('emails_json', JSON.stringify(data.emails));
    formData.append('subject', data.subject);
    formData.append('body', data.body);
    formData.append('follow_up_delay', data.follow_up_delay.toString());
    if (data.sender_emails && data.sender_emails.length > 0) {
      formData.append('sender_emails_json', JSON.stringify(data.sender_emails));
    }
    if (data.follow_up_body) formData.append('follow_up_body', data.follow_up_body);
    if (data.auto_reply_prompt) formData.append('auto_reply_prompt', data.auto_reply_prompt);
    if (data.attachment) {
      formData.append('attachment', data.attachment);
    }
    if (data.delay_seconds !== undefined) {
      formData.append('delay_seconds', data.delay_seconds.toString());
    }
    if (data.min_send_delay !== undefined) {
      formData.append('min_send_delay', data.min_send_delay.toString());
    }
    if (data.max_send_delay !== undefined) {
      formData.append('max_send_delay', data.max_send_delay.toString());
    }
    if (data.enable_human_pauses !== undefined) {
      formData.append('enable_human_pauses', data.enable_human_pauses ? 'true' : 'false');
    }
    if (data.test_mode !== undefined) {
      formData.append('test_mode', data.test_mode ? 'true' : 'false');
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const response = await safeFetch('/emails/send-bulk', {
      method: 'POST',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to send campaign');
    }
    return response.json();
  },

  async simulateCadence(params: { count: number, min_delay?: number, max_delay?: number, enable_human_pauses?: boolean }) {
    const response = await safeFetch('/emails/simulate-cadence', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Simulation failed');
    }
    return response.json();
  },

  async getAutoReplySuggestions(subject: string, body: string) {
    const response = await safeFetch('/emails/auto-reply-suggestions', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ subject, body }),
    });
    if (!response.ok) return { suggestions: [] };
    return response.json();
  },

  async scheduleFollowUp(data: { lead_email: string; subject: string; body: string; delay_hours: number }) {
    const response = await safeFetch('/emails/schedule-followup', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to schedule follow-up');
    }
    return response.json();
  },

  async generateEmailContent(prompt: string, leads_context?: any[]) {
    const response = await safeFetch('/emails/generate-content', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ prompt, leads_context, personalize: true }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to generate content');
    }
    return response.json();
  },

  async generateFollowupContent(original_subject: string, original_body: string) {
    const response = await safeFetch('/emails/generate-followup-content', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ original_subject, original_body }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to generate followup content');
    }
    return response.json();
  },

  async generateFollowupFromPrompt(data: { prompt: string; original_subject: string; original_body: string }) {
    const response = await safeFetch('/emails/generate-followup-from-prompt', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to generate followup content from prompt');
    }
    return response.json();
  },

  async processReplies() {
    const response = await safeFetch('/emails/process-replies', {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to process replies');
    }
    return response.json();
  },

  // Settings
  async getSettings() {
    const response = await safeFetch('/settings/', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch settings');
    }
    return response.json();
  },

  async updateSettings(data: any) {
    const response = await safeFetch('/settings/', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update settings');
    }
    return response.json();
  },

  // Client Responses
  async getResponses() {
    const response = await safeFetch('/responses/', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch responses');
    }
    return response.json();
  },

  async getCampaignDashboard() {
    const response = await safeFetch('/responses/campaigns', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch campaign dashboard');
    }
    return response.json();
  },

  async getThread(threadId: string) {
    const response = await safeFetch(`/responses/thread/${threadId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch thread');
    }
    return response.json();
  },

  async deleteResponse(id: string) {
    const response = await safeFetch(`/responses/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete response');
    }
    return response.json();
  },

  async deleteCampaign(campaignId: string) {
    const response = await safeFetch(`/responses/campaign/${campaignId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete campaign');
    }
    return response.json();
  },

  // Recent activity logs for dashboard
  async getRecentLogs(limit = 50) {
    const response = await safeFetch(`/logs/recent?limit=${limit}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch logs');
    }
    return response.json();
  },

  async getStats() {
    const response = await safeFetch('/logs/stats', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch stats');
    }
    return response.json();
  },

  async deleteLog(id: string) {
    const response = await safeFetch(`/logs/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete log');
    }
    return response.json();
  },

  // Developer & API Keys
  async getApiKeys() {
    const response = await safeFetch('/api/developer/keys', {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch API keys');
    }
    return response.json();
  },

  async createApiKey(name: string) {
    const response = await safeFetch('/api/developer/keys', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create API key');
    }
    return response.json();
  },

  async deleteApiKey(keyId: string) {
    const response = await safeFetch(`/api/developer/keys/${keyId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to revoke API key');
    }
    return response.json();
  },
};


