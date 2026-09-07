import gspread
from google.oauth2.service_account import Credentials
from app.config import settings
import datetime

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


class SheetsService:
    def __init__(self):
        self.creds_file = settings.google_credentials_file
        self._client = None

    @property
    def sheet_id(self):
        return settings.google_sheet_id

    def _get_client(self):
        """Returns an authenticated gspread client (lazy init)."""
        if self._client is not None:
            return self._client
        try:
            creds = Credentials.from_service_account_file(self.creds_file, scopes=SCOPES)
            self._client = gspread.authorize(creds)
            print("[Sheets] Authenticated with Google Sheets successfully.")
        except FileNotFoundError:
            print(f"[Sheets] ERROR: credentials file '{self.creds_file}' not found.")
            self._client = None
        except Exception as e:
            print(f"[Sheets] ERROR during authentication: {e}")
            self._client = None
        return self._client

    async def log_lead_to_sheet(self, name: str = "N/A", email: str = "", company: str = "", notes: str = ""):
        """Appends a new lead to a dedicated 'Leads' worksheet."""
        if not self.sheet_id:
            print("[Sheets] SKIPPED: GOOGLE_SHEET_ID is not set.")
            return

        import asyncio
        client = await asyncio.to_thread(self._get_client)
        if client is None: return

        try:
            spreadsheet = await asyncio.to_thread(client.open_by_key, self.sheet_id)
            
            # Try to get or create a 'Leads' worksheet
            try:
                sheet = await asyncio.to_thread(spreadsheet.worksheet, "Leads")
            except gspread.exceptions.WorksheetNotFound:
                sheet = await asyncio.to_thread(spreadsheet.add_worksheet, title="Leads", rows="100", cols="20")
                await asyncio.to_thread(sheet.insert_row, ["Name", "Email", "Company", "Notes", "Timestamp"], index=1)
                print("[Sheets] 'Leads' sheet created.")

            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            row = [name.strip(), email.strip(), company.strip(), notes.strip(), timestamp]
            await asyncio.to_thread(sheet.append_row, row, value_input_option="USER_ENTERED")
            print(f"[Sheets] Lead Logged: {name} ({email})")
        except Exception as e:
            print(f"[Sheets] ERROR logging lead: {e}")

    async def log_responder_to_sheet(self, name: str, email: str, message_snippet: str):
        """Appends a responder row to 'Responders' worksheet."""
        if not self.sheet_id:
            print("[Sheets] SKIPPED: GOOGLE_SHEET_ID is not set.")
            return

        import asyncio
        client = await asyncio.to_thread(self._get_client)
        if client is None: return

        try:
            spreadsheet = await asyncio.to_thread(client.open_by_key, self.sheet_id)
            
            # Try to get or create a 'Responders' worksheet
            try:
                sheet = await asyncio.to_thread(spreadsheet.worksheet, "Responders")
            except gspread.exceptions.WorksheetNotFound:
                sheet = await asyncio.to_thread(spreadsheet.add_worksheet, title="Responders", rows="100", cols="20")
                await asyncio.to_thread(sheet.insert_row, ["Name", "Email", "Query / Message", "Timestamp"], index=1)
                print("[Sheets] 'Responders' sheet created.")

            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            row = [name.strip(), email.strip(), message_snippet[:200], timestamp]
            await asyncio.to_thread(sheet.append_row, row, value_input_option="USER_ENTERED")
            print(f"[Sheets] Responder Logged: {name} ({email})")
        except Exception as e:
            print(f"[Sheets] ERROR logging responder: {e}")


    async def log_campaign_to_sheet(self, recipient: str, subject: str, timestamp: str):
        """Appends a campaign send event to 'Campaigns' worksheet."""
        if not self.sheet_id: return
        import asyncio
        client = await asyncio.to_thread(self._get_client)
        if client is None: return
        try:
            spreadsheet = await asyncio.to_thread(client.open_by_key, self.sheet_id)
            try:
                sheet = await asyncio.to_thread(spreadsheet.worksheet, "Campaigns")
            except gspread.exceptions.WorksheetNotFound:
                sheet = await asyncio.to_thread(spreadsheet.add_worksheet, title="Campaigns", rows="1000", cols="10")
                await asyncio.to_thread(sheet.insert_row, ["Recipient", "Subject", "Timestamp"], index=1)
            
            row = [recipient, subject, timestamp]
            await asyncio.to_thread(sheet.append_row, row, value_input_option="USER_ENTERED")
        except Exception as e:
            print(f"[Sheets] ERROR logging campaign: {e}")

    async def fetch_leads_from_url(self, sheet_url: str) -> list[dict]:
        """
        Fetches lead records from a Google Spreadsheet URL.
        Supports both Service Account authorization and public CSV export fallback.
        """
        import re
        import csv
        import io
        import requests
        import asyncio

        # Extract Spreadsheet ID
        match = re.search(r'/d/([a-zA-Z0-9-_]+)', sheet_url)
        spreadsheet_id = match.group(1) if match else sheet_url.strip()

        records = []

        # 1. Try gspread client first if credentials exist
        client = await asyncio.to_thread(self._get_client)
        if client is not None:
            try:
                spreadsheet = await asyncio.to_thread(client.open_by_key, spreadsheet_id)
                sheet = await asyncio.to_thread(lambda: spreadsheet.get_worksheet(0))
                if sheet:
                    raw_records = await asyncio.to_thread(sheet.get_all_records)
                    records = raw_records
            except Exception as e:
                print(f"[Sheets] gspread fetch failed ({e}), falling back to public export URL...")

        # 2. Fallback: Public CSV export URL
        if not records:
            export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv"
            try:
                resp = await asyncio.to_thread(requests.get, export_url, timeout=10)
                if resp.ok:
                    csv_text = resp.text
                    reader = csv.DictReader(io.StringIO(csv_text))
                    records = list(reader)
                else:
                    print(f"[Sheets] Public CSV fetch failed with status code {resp.status_code}")
            except Exception as e:
                print(f"[Sheets] Public CSV fetch error: {e}")

        if not records:
            raise Exception("Unable to access Google Sheet. Please check the URL and ensure the sheet is accessible or shared.")

        # Normalize lead records
        parsed_leads = []
        for r in records:
            # Case-insensitive column search
            normalized_row = {str(k).strip().lower(): str(v).strip() for k, v in r.items() if k is not None}
            
            email = next((v for k, v in normalized_row.items() if 'email' in k or 'mail' in k), '')
            if not email or '@' not in email:
                continue # Skip invalid email rows

            name = next((v for k, v in normalized_row.items() if 'name' in k or 'lead' in k or 'contact' in k), '')
            company = next((v for k, v in normalized_row.items() if 'company' in k or 'org' in k or 'business' in k), '')
            notes = next((v for k, v in normalized_row.items() if 'note' in k or 'comment' in k or 'detail' in k), '')

            parsed_leads.append({
                "name": name or email.split('@')[0],
                "email": email,
                "company": company,
                "notes": notes
            })

        return parsed_leads


sheets_service = SheetsService()
