# 🤖 Email Marketing AI Agent - Complete System Documentation

---

## 📌 Table of Contents
1. [Overview](#overview)
2. [What It Has (Architecture & Core Components)](#what-it-has-architecture--core-components)
   - [Tech Stack](#tech-stack)
   - [Project Directory Structure](#project-directory-structure)
   - [Database Schemas & Collections](#database-schemas--collections)
   - [Backend Core Services](#backend-core-services)
   - [Frontend Architecture](#frontend-architecture)
3. [What It Can Do (Features & Capabilities)](#what-it-can-do-features--capabilities)
   - [1. Multi-Account Gmail Dispatcher & Round-Robin Rotation](#1-multi-account-gmail-dispatcher--round-robin-rotation)
   - [2. Google OAuth 2.0 & Secure Token Management](#2-google-oauth-20--secure-token-management)
   - [3. Multi-Format Lead Import & Google Sheets Sync](#3-multi-format-lead-import--google-sheets-sync)
   - [4. AI Content Generation & Dynamic Lead Personalization](#4-ai-content-generation--dynamic-lead-personalization)
   - [5. Live Personalization Preview System](#5-live-personalization-preview-system)
   - [6. Bulk Campaign Dispatch & PDF Attachment Support](#6-bulk-campaign-dispatch--pdf-attachment-support)
   - [7. Automated Reply Detection & LangGraph AI Auto-Replies](#7-automated-reply-detection--langgraph-ai-auto-replies)
   - [8. AI Auto-Reply Strategy Suggestions Generator](#8-ai-auto-reply-strategy-suggestions-generator)
   - [9. Dynamic AI-Powered Automated Follow-Ups](#9-dynamic-ai-powered-automated-follow-ups)
   - [10. Campaign Analytics, Thread History & Responses Inbox](#10-campaign-analytics-thread-history--responses-inbox)
   - [11. System Audit Logs & Live Activity Monitoring](#11-system-audit-logs--live-activity-monitoring)
4. [How To Do (Setup & Usage Guide)](#how-to-do-setup--usage-guide)
   - [Prerequisites](#prerequisites)
   - [Step 1: Environment Setup & Configuration](#step-1-environment-setup--configuration)
   - [Step 2: Google Cloud Console & API Setup](#step-2-google-cloud-console--api-setup)
   - [Step 3: Running the Application](#step-3-running-the-application)
   - [Step 4: End-to-End Workflow & User Manual](#step-4-end-to-end-workflow--user-manual)
5. [API Reference & Endpoint Summary](#api-reference--endpoint-summary)

---

## 📖 Overview

The **Email Marketing AI Agent** is an enterprise-ready, full-stack automated email outreach platform powered by **Google Gemini AI**, **LangGraph**, **FastAPI**, **Next.js 15**, **MongoDB**, and **Google Workspace APIs (Gmail & Google Sheets)**. 

It enables businesses and marketers to construct high-conversion cold email campaigns, dynamically personalize messages per prospect, attach PDF proposals, manage multi-account round-robin sender rotation, run scheduled follow-up sequences, detect incoming prospect replies in real-time, and draft or dispatch contextual AI auto-responses automatically.

---

## 🏗️ What It Has (Architecture & Core Components)

### Tech Stack

#### **Backend (Python 3.10+)**
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Asynchronous ASGI server powered by Uvicorn)
- **AI / LLM Orchestration**: Google Gemini (`gemini-1.5-flash`), LangChain & LangGraph (Single-pass graph workflow)
- **Database**: MongoDB (Async driver using `motor` and `pymongo` with `dnspython`)
- **Email & Cloud Integrations**: Google Gmail API (OAuth 2.0), `gspread` (Google Sheets integration)
- **File Parsing**: `openpyxl` (Excel .xlsx/.xls parser) and Python `csv` module
- **Security & Cryptography**: Fernet symmetric encryption (`cryptography`), JWT tokens (`python-jose`), Passlib

#### **Frontend (TypeScript / Next.js 15)**
- **Framework**: Next.js App Router, React 19, TypeScript
- **Styling**: Vanilla CSS & CSS Modules with modern glassmorphism UI elements
- **HTTP Client**: Native Fetch API with Bearer token authorization wrapper (`api.ts`)

---

### Project Directory Structure

```
Email-marketer/
├── app/                        # FastAPI Backend Application
│   ├── api/                    # API Route Handlers
│   │   ├── auth.py             # Google OAuth2 login, callback, me & account management
│   │   ├── emails.py           # Bulk send, AI generation, follow-up & prompt endpoints
│   │   ├── leads.py            # Lead creation, CSV/Excel & Google Sheet URL import
│   │   ├── logs.py             # System activity, audit logs & analytics stats
│   │   ├── responses.py        # Prospect response tracking, campaign grouping & thread viewer
│   │   └── settings.py         # Custom auto-reply rules & prompt configuration
│   ├── models/                 # Pydantic Schemas & Data Models
│   │   ├── lead.py             # Lead creation and response models
│   │   └── user.py             # User profile schemas
│   ├── services/               # Core Business Logic Services
│   │   ├── ai_service.py       # Claude AI generation & LangGraph auto-reply graph
│   │   ├── auto_reply_service.py # Gmail inbox scanner & AI response dispatcher
│   │   ├── email_service.py    # Multi-account Gmail API sender with PDF & tag replacement
│   │   ├── follow_up_service.py # Scheduled background follow-up worker
│   │   ├── security_service.py  # AES/Fernet encryption for tokens
│   │   └── sheets_service.py   # Google Sheets logging & sheet URL reader
│   ├── config.py               # Pydantic Settings & Environment loader
│   ├── db.py                   # MongoDB async Motor client & collection instances
│   └── main.py                 # FastAPI application root & background monitoring task
├── frontend/                   # Next.js 15 Frontend Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── auth/callback/  # OAuth redirect listener page
│   │   │   ├── campaign-dashboard/ # Metrics, charts & analytics view
│   │   │   ├── campaigns/      # Campaign architect with AI generator & multi-account dispatch
│   │   │   ├── leads/          # Prospect table, CSV/Excel upload & Google Sheet URL sync
│   │   │   ├── login/          # Google OAuth login page
│   │   │   ├── responses/      # Prospect response inbox, thread history & auto-reply control
│   │   │   ├── settings/       # Custom prompt rules & API config page
│   │   │   ├── layout.tsx      # Root layout wrapper
│   │   │   └── page.tsx        # Dashboard / Landing overview
│   │   └── lib/
│   │       └── api.ts          # Frontend API client library
│   ├── package.json
│   └── tsconfig.json
├── .env                        # Environment variables configuration
├── credentials.json            # Google Cloud Service Account credentials (optional)
└── requirements.txt            # Python dependencies
```

---

### Database Schemas & Collections

The MongoDB database utilizes 5 main collections:

1. `users_collection`
   - Stores user profiles, encrypted OAuth `access_token` and `refresh_token`, granted scopes, account auth status (`active`/`expired`), and last login timestamps.
2. `leads_collection`
   - Stores prospect details: `name`, `email`, `company`, `notes`, `user_email`, `status` (`pending`, `contacted`, `replied`), and `created_at`.
3. `email_logs_collection`
   - Master log storing both sent messages and incoming responses: `user_email`, `recipient`, `subject`, `body`, `type` (`sent`/`response`), `campaign_id`, `gmail_id`, `thread_id`, `reply_received`, `follow_up_sent`, `follow_up_at`, `auto_reply_prompt`, `intent`, `ai_reply`, and `timestamp`.
4. `settings_collection`
   - User configuration: `user_email`, `auto_reply_enabled` (boolean), `default_follow_up_delay`, and custom system prompt rules.
5. `system_logs_collection`
   - Audit logs recording system operations: `timestamp`, `level`, `event_type`, `user_email`, and `details`.

---

### Backend Core Services

- **`ai_service.py`**: Integrates with Claude (`claude-sonnet-4-6`). Houses the LangGraph single-pass state graph for intent classification (`interest`, `question`, `unsubscribe`, `spam`) and contextual response drafting. Generates email campaigns, follow-up copy, and auto-reply strategies.
- **`email_service.py`**: Interacts with Gmail API using user OAuth tokens. Supports multi-account sender rotation, MIME multipart message construction, PDF attachments, and dynamic variable replacements (`{name}`, `{company}`, `{first_name}`, etc.).
- **`auto_reply_service.py`**: Scans user Gmail inboxes for prospect replies. Flags `reply_received: True`, halts scheduled follow-ups, passes reply content to `ai_service`, and dispatches AI responses automatically.
- **`follow_up_service.py`**: Background worker loop checking for unreplied campaign dispatches past their scheduled follow-up delay, automatically generating and dispatching follow-up emails in the same thread.
- **`sheets_service.py`**: Integrates with `gspread` and public CSV fallbacks to import prospect leads from Google Sheet URLs, and appends send events and responder logs to Google Sheets.
- **`security_service.py`**: Symmetric encryption helper using Fernet to secure access and refresh tokens at rest in MongoDB.

---

## 🎯 What It Can Do (Features & Capabilities)

### 1. Multi-Account Gmail Dispatcher & Round-Robin Rotation
- Connect multiple Gmail sender accounts under a single user profile.
- Choose between **Multi-Mail Round-Robin Rotation** (distributes batch dispatches evenly across all active accounts) or **Single Account Dispatch**.
- Protects domain sender reputation and bypasses daily per-account Google sending limits.
- Account manager UI with real-time health indicator (`Active` / `Expired`) and one-click account disconnection.

### 2. Google OAuth 2.0 & Secure Token Management
- OAuth 2.0 authentication requesting `gmail.modify` and `gmail.send` scopes.
- AES Fernet token encryption before persisting in MongoDB.
- Automatic background token refresh without requiring manual re-login.

### 3. Multi-Format Lead Import & Google Sheets Sync
- Add individual leads manually via the web interface.
- Import bulk lead lists from **CSV** files (`.csv`) or **Excel** spreadsheets (`.xlsx`, `.xls`).
- Import leads directly by pasting a **Google Sheet URL** (supports both Google Service Account and public sheet CSV fallbacks).
- Automatic lead deduplication by email address per user.

### 4. AI Content Generation & Dynamic Lead Personalization
- One-click prompt-to-campaign generation using Claude AI.
- Dynamic tag replacement engine: insert `{name}`, `{first_name}`, `{company}`, `{email}`, or `{notes}` into campaign subjects and bodies.
- Case-insensitive regex substitution customizes every email uniquely for each recipient before dispatch.

### 5. Live Personalization Preview System
- Interactive preview mode in the campaign architect UI.
- Select any prospect from your lead list to view instant, rendered output of personalized variable tags in both Subject and Body before sending.

### 6. Bulk Campaign Dispatch & PDF Attachment Support
- Asynchronous concurrent email sending with configurable concurrency limits.
- Upload optional PDF attachments (e.g., product brochures, proposals, pricing sheets).
- Auto-generates unique `campaign_id` UUIDs for campaign batch tracking.

### 7. Automated Reply Detection & LangGraph AI Auto-Replies
- Continuous background scanner (`background_monitoring_task`) inspecting connected Gmail inboxes every 2 minutes.
- Automatically marks prospects as `reply_received: True` upon receiving an email.
- Halts further follow-ups to prevent spamming responsive leads.
- Evaluates incoming messages using LangGraph to classify intent (`interest`, `question`, `unsubscribe`, `spam`) and sends contextual AI auto-replies.

### 8. AI Auto-Reply Strategy Suggestions Generator
- Generates 3 short, distinct AI auto-responder strategy suggestions tailored to your campaign content (e.g., *"Focus on pricing objections"*, *"Push for a 5-min discovery call"*).

### 9. Dynamic AI-Powered Automated Follow-Ups
- Flexible follow-up delays (e.g., 1 hour, 1 day, 3 days, or custom intervals).
- Supports manual follow-up body templates or automated AI-generated follow-up copy.
- Sends follow-up emails directly within existing Gmail conversation threads.

### 10. Campaign Analytics, Thread History & Responses Inbox
- Grouped campaign dashboard showing sent count, lead status, reply flags, and conversion rate.
- Dedicated Responses inbox (`/responses`) to read incoming prospect queries.
- Thread viewer (`/responses/thread/{thread_id}`) showing full conversation history.

### 11. System Audit Logs & Live Activity Monitoring
- Real-time logging of authentication events, email dispatches, AI generations, and error tracebacks.
- Aggregate metrics endpoint (`GET /logs/stats`) and searchable log viewer.

---

## 🛠️ How To Do (Setup & Usage Guide)

### Prerequisites
- **Python 3.10+** installed
- **Node.js 18+** and `npm` installed
- **MongoDB** running locally (`mongodb://localhost:27017`) or a MongoDB Atlas connection string
- **Anthropic API Key** (for Claude AI)
- **Google Cloud Console Project** with Gmail API enabled

---

### Step 1: Environment Setup & Configuration

Create a `.env` file in the root directory `Email-marketer/.env`:

```env
# MongoDB Configuration
MONGODB_URL=mongodb://localhost:27017

# Anthropic AI Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-6

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
REDIRECT_URI=http://localhost:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000

# Security & Encryption Keys
ENCRYPTION_KEY=Nf2a5TNSXpq79VD2KPB-sSLc0US1WFH-95kQA5_ADdU=
SECRET_KEY=super_secret_jwt_key_for_session_tokens

# Google Sheets Configuration (Optional)
GOOGLE_SHEET_ID=your_google_sheet_id_here
GOOGLE_CREDENTIALS_FILE=credentials.json
```

---

### Step 2: Google Cloud Console & API Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project named `Email Marketer Agent`.
3. Enable **Gmail API** (and optionally **Google Sheets API**) under **APIs & Services > Library**.
4. Go to **APIs & Services > OAuth consent screen**:
   - Select **External**.
   - Add scopes: `openid`, `userinfo.email`, `userinfo.profile`, `gmail.modify`, `gmail.send`.
   - Add your test email address under **Test Users**.
5. Go to **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URIs: `http://localhost:8000/api/auth/callback`.
   - Copy Client ID & Client Secret into `.env`.

---

### Step 3: Running the Application

#### **1. Start the Backend API (FastAPI)**

Open a terminal in the project root:

```powershell
# Navigate to project root
cd "f:\AGENTIC Ai\Email-marketer"

# Activate virtual environment
.\venv\Scripts\activate

# Install requirements if needed
pip install -r requirements.txt

# Start FastAPI server
uvicorn app.main:app --reload --port 8000
```
> 🌐 API: `http://localhost:8000` | Swagger Docs: `http://localhost:8000/docs`

#### **2. Start the Frontend Application (Next.js)**

Open a second terminal window:

```powershell
# Navigate to frontend directory
cd "f:\AGENTIC Ai\Email-marketer\frontend"

# Install node packages if needed
npm install

# Start Next.js development server
npm run dev
```
> 💻 Dashboard UI: `http://localhost:3000`

---

### Step 4: End-to-End Workflow & User Manual

#### **1. User Authentication & Account Connection**
1. Navigate to `http://localhost:3000`.
2. Click **Sign in with Google** to connect your primary Gmail account.
3. To add additional sending accounts, navigate to **Campaigns** and click **➕ Connect Gmail Account**.

#### **2. Importing Leads**
1. Go to **Leads** (`/leads`).
2. Add single leads manually, upload a **CSV** or **Excel (.xlsx)** file, or paste a **Google Sheet URL** and click **Sync from Google Sheet URL**.

#### **3. Designing & Dispatching a Campaign**
1. Go to **Campaigns** (`/campaigns`).
2. Select your target leads and choose your dispatch mode (**Multi-Mail Round Robin** or **Single Account**).
3. Click **✨ Generate** to draft email content with Claude AI.
4. Insert variable tags like `{name}` or `{company}` into the Subject or Body.
5. Click **👁️ Live Personalization Preview** to test personalized outputs for any lead.
6. (Optional) Upload a PDF brochure attachment.
7. Configure follow-up delay (e.g. 2 days) and custom auto-reply rules.
8. Click **🚀 Send Bulk Emails**.

#### **4. Automated Tracking & Responses**
1. The background monitor checks inboxes every 2 minutes.
2. When a lead replies, follow-ups halt automatically, the conversation is logged in **Responses** (`/responses`), and an AI response is sent in-thread.

---

## 🔌 API Reference & Endpoint Summary

| Category | Method | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **Auth** | `GET` | `/api/auth/login` | Initiates Google OAuth2 flow and returns authorization URL |
| **Auth** | `GET` | `/api/auth/callback` | OAuth2 callback handler; exchanges code for JWT & stores encrypted tokens |
| **Auth** | `GET` | `/api/auth/me` | Returns current authenticated user profile |
| **Auth** | `GET` | `/api/auth/accounts` | Returns all connected Gmail sender accounts & auth health status |
| **Auth** | `DELETE` | `/api/auth/accounts/{email}` | Disconnects a connected Gmail account |
| **Leads** | `GET` | `/leads/` | Fetches stored leads for the authenticated user |
| **Leads** | `POST` | `/leads/` | Creates a new lead record manually |
| **Leads** | `POST` | `/leads/import-sheet-url` | Imports leads directly from a Google Sheet URL |
| **Leads** | `POST` | `/leads/import-file` | Imports leads from uploaded CSV or Excel (`.xlsx`/`.xls`) file |
| **Leads** | `DELETE` | `/leads/{lead_id}` | Deletes a single lead record |
| **Emails** | `POST` | `/emails/generate-content` | Uses Claude AI to draft email content from prompt |
| **Emails** | `POST` | `/emails/generate-followup-content` | Generates AI follow-up text based on previous email |
| **Emails** | `POST` | `/emails/generate-followup-from-prompt` | Generates AI follow-up text using custom user prompt |
| **Emails** | `POST` | `/emails/auto-reply-suggestions` | Generates 3 strategy suggestions for campaign auto-responder |
| **Emails** | `POST` | `/emails/send-bulk` | Dispatches bulk emails with multi-account rotation & PDF attachment |
| **Emails** | `POST` | `/emails/process-followups` | Triggers background processing of pending follow-ups |
| **Emails** | `POST` | `/emails/process-replies` | Triggers manual inbox scan & AI auto-reply dispatch |
| **Responses**| `GET` | `/responses/` | Returns all client response logs |
| **Responses**| `GET` | `/responses/campaigns` | Returns grouped campaign analytics dashboard |
| **Responses**| `GET` | `/responses/thread/{thread_id}` | Returns all emails in a specific conversation thread |
| **Responses**| `DELETE` | `/responses/campaign/{campaign_id}` | Deletes logs associated with a campaign ID |
| **Responses**| `DELETE` | `/responses/{response_id}` | Deletes a single response log entry |
| **Settings** | `GET` | `/settings/` | Fetches application settings & prompt rules |
| **Settings** | `POST` | `/settings/` | Updates application settings |
| **Logs** | `GET` | `/logs/recent` | Retrieves recent system activity logs |
| **Logs** | `GET` | `/logs/stats` | Returns aggregate dashboard metrics (sent count, reply count) |
| **Logs** | `DELETE` | `/logs/{log_id}` | Deletes an individual audit log |

---

*Documentation updated for Email Marketing AI Agent System.*
