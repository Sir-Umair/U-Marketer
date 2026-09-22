import re
import csv
import io
from datetime import datetime
from typing import List, Optional
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from pydantic import BaseModel

from app.models.lead import LeadCreate, LeadResponse
from app.db import leads_collection, users_collection
from app.api.auth import get_current_user
from app.services.sheets_service import sheets_service

router = APIRouter(prefix="/leads", tags=["Leads"])


class SheetImportRequest(BaseModel):
    sheet_url: str


def format_lead(lead: dict) -> dict:
    doc = dict(lead)
    doc["id"] = str(doc.pop("_id"))
    return doc


async def _get_workspace_emails(user: dict) -> List[str]:
    """Retrieves all connected user emails in the current workspace."""
    all_emails = [user["email"]]
    if users_collection is not None:
        try:
            connected_docs = await users_collection.find(
                {"access_token": {"$exists": True}},
                {"email": 1}
            ).to_list(100)
            for d in connected_docs:
                if d.get("email"):
                    all_emails.append(d["email"])
        except Exception as e:
            print(f"[Leads] Error fetching connected accounts: {e}")
    return list(set(e.lower().strip() for e in all_emails if e))


@router.post("/", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
async def create_lead(lead: LeadCreate, user: dict = Depends(get_current_user)):
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    workspace_emails = await _get_workspace_emails(user)
    email_clean = lead.email.lower().strip()

    # Check for existing lead across the workspace
    existing = await leads_collection.find_one({
        "email": {"$regex": f"^{re.escape(email_clean)}$", "$options": "i"},
        "$or": [
            {"user_email": {"$in": workspace_emails}},
            {"user_email": None},
            {"user_email": {"$exists": False}}
        ]
    })

    if existing:
        # Update existing record if new info is provided
        update_fields = {}
        if lead.name and lead.name != existing.get("name"):
            update_fields["name"] = lead.name
        if lead.company and lead.company != existing.get("company"):
            update_fields["company"] = lead.company
        if lead.notes and lead.notes != existing.get("notes"):
            update_fields["notes"] = lead.notes
        if update_fields:
            await leads_collection.update_one({"_id": existing["_id"]}, {"$set": update_fields})
            existing.update(update_fields)
        return format_lead(existing)

    lead_dict = lead.model_dump()
    lead_dict["email"] = email_clean
    lead_dict["user_email"] = user["email"]
    lead_dict["created_at"] = datetime.utcnow()

    result = await leads_collection.insert_one(lead_dict)
    lead_dict["_id"] = result.inserted_id

    # Log to Google Sheets
    try:
        await sheets_service.log_lead_to_sheet(
            name=lead_dict.get("name") or "N/A",
            email=lead_dict["email"],
            company=lead_dict.get("company", ""),
            notes=lead_dict.get("notes", "")
        )
    except Exception as e:
        print(f"[Leads] Sheet log notice: {e}")

    return format_lead(lead_dict)


@router.get("/", response_model=List[LeadResponse])
async def get_leads(user: dict = Depends(get_current_user)):
    """
    Returns all deduplicated leads across all accounts in the workspace.
    Solves account-siloing where leads were previously hidden.
    """
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database connection not established")

    try:
        workspace_emails = await _get_workspace_emails(user)
        email_regex_patterns = [f"^{re.escape(e)}$" for e in workspace_emails]

        cursor = leads_collection.find({
            "$or": [
                {"user_email": {"$in": workspace_emails}},
                {"user_email": {"$regex": "|".join(email_regex_patterns), "$options": "i"}},
                {"user_email": None},
                {"user_email": {"$exists": False}}
            ]
        }).sort("created_at", -1)

        all_docs = await cursor.to_list(length=3000)

        # Deduplicate leads by email, preserving richest data
        unique_leads = {}
        for doc in all_docs:
            em = (doc.get("email") or "").strip().lower()
            if not em:
                continue
            if em not in unique_leads:
                unique_leads[em] = doc
            else:
                existing = unique_leads[em]
                if not existing.get("company") and doc.get("company"):
                    existing["company"] = doc["company"]
                if not existing.get("name") and doc.get("name"):
                    existing["name"] = doc["name"]
                if not existing.get("notes") and doc.get("notes"):
                    existing["notes"] = doc["notes"]

        return [format_lead(doc) for doc in unique_leads.values()]
    except Exception as e:
        print(f"[Leads] Error fetching workspace leads: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching leads: {str(e)}")


@router.post("/import-sheet-url")
async def import_leads_from_sheet_url(req: SheetImportRequest, user: dict = Depends(get_current_user)):
    """Imports leads directly from a Google Spreadsheet URL into the workspace lead database."""
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    if not req.sheet_url or not req.sheet_url.strip():
        raise HTTPException(status_code=400, detail="Google Spreadsheet URL is required")

    try:
        raw_leads = await sheets_service.fetch_leads_from_url(req.sheet_url)
        if not raw_leads:
            raise HTTPException(status_code=400, detail="No valid lead records found in the Google Sheet.")

        workspace_emails = await _get_workspace_emails(user)
        imported_count = 0
        skipped_count = 0

        for l in raw_leads:
            email = l["email"].lower().strip()
            # Check for existing lead across the entire workspace
            existing = await leads_collection.find_one({
                "email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
                "$or": [
                    {"user_email": {"$in": workspace_emails}},
                    {"user_email": None},
                    {"user_email": {"$exists": False}}
                ]
            })
            if existing:
                skipped_count += 1
                continue

            lead_doc = {
                "name": l.get("name") or email.split("@")[0],
                "email": email,
                "company": l.get("company", ""),
                "notes": l.get("notes", ""),
                "user_email": user["email"],
                "created_at": datetime.utcnow()
            }
            await leads_collection.insert_one(lead_doc)
            imported_count += 1

        return {
            "success": True,
            "imported": imported_count,
            "skipped": skipped_count,
            "total_found": len(raw_leads),
            "message": f"Successfully imported {imported_count} new leads ({skipped_count} duplicates skipped)."
        }
    except Exception as e:
        print(f"[Leads] Error importing from Sheet URL: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import-file")
async def import_leads_from_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Imports leads from an uploaded CSV or Excel (.xlsx, .xls) file."""
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    filename = file.filename.lower()
    contents = await file.read()

    raw_leads = []

    if filename.endswith(".csv"):
        text = contents.decode("utf-8", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))
        for r in reader:
            raw_leads.append(r)
    elif filename.endswith(".xlsx") or filename.endswith(".xls"):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(filename=io.BytesIO(contents), data_only=True)
            sheet = wb.active
            rows = list(sheet.iter_rows(values_only=True))
            if rows:
                headers = [str(cell).strip() if cell is not None else "" for cell in rows[0]]
                for row in rows[1:]:
                    row_dict = {}
                    for h, val in zip(headers, row):
                        if h:
                            row_dict[h] = str(val).strip() if val is not None else ""
                    if row_dict:
                        raw_leads.append(row_dict)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format. Please upload a .csv or .xlsx file.")

    if not raw_leads:
        raise HTTPException(status_code=400, detail="No records found in the uploaded file.")

    workspace_emails = await _get_workspace_emails(user)
    imported_count = 0
    skipped_count = 0

    for r in raw_leads:
        norm = {str(k).strip().lower(): str(v).strip() for k, v in r.items() if k is not None}
        email = next((v for k, v in norm.items() if 'email' in k or 'mail' in k), '')
        if not email or '@' not in email:
            continue

        email = email.lower().strip()
        existing = await leads_collection.find_one({
            "email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
            "$or": [
                {"user_email": {"$in": workspace_emails}},
                {"user_email": None},
                {"user_email": {"$exists": False}}
            ]
        })
        if existing:
            skipped_count += 1
            continue

        name = next((v for k, v in norm.items() if 'name' in k or 'lead' in k or 'contact' in k), '')
        company = next((v for k, v in norm.items() if 'company' in k or 'org' in k or 'business' in k), '')
        notes = next((v for k, v in norm.items() if 'note' in k or 'comment' in k or 'detail' in k), '')

        lead_doc = {
            "name": name or email.split("@")[0],
            "email": email,
            "company": company,
            "notes": notes,
            "user_email": user["email"],
            "created_at": datetime.utcnow()
        }
        await leads_collection.insert_one(lead_doc)
        imported_count += 1

    return {
        "success": True,
        "imported": imported_count,
        "skipped": skipped_count,
        "total_found": len(raw_leads),
        "message": f"Successfully imported {imported_count} new leads ({skipped_count} duplicates skipped)."
    }


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(lead_id: str, user: dict = Depends(get_current_user)):
    """Deletes a lead and its workspace duplicates safely."""
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    if not ObjectId.is_valid(lead_id):
        raise HTTPException(status_code=400, detail="Invalid lead ID format")

    lead_doc = await leads_collection.find_one({"_id": ObjectId(lead_id)})
    if not lead_doc:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead_email = (lead_doc.get("email") or "").strip().lower()
    workspace_emails = await _get_workspace_emails(user)

    if lead_email:
        # Delete all instances of this lead email in this workspace
        await leads_collection.delete_many({
            "email": {"$regex": f"^{re.escape(lead_email)}$", "$options": "i"},
            "$or": [
                {"user_email": {"$in": workspace_emails}},
                {"user_email": None},
                {"user_email": {"$exists": False}}
            ]
        })
    else:
        await leads_collection.delete_one({"_id": ObjectId(lead_id)})

    return None
