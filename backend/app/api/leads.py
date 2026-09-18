from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
import csv
import io
from app.models.lead import LeadCreate, LeadResponse
from app.db import leads_collection
from app.api.auth import get_current_user
from app.services.sheets_service import sheets_service

router = APIRouter(prefix="/leads", tags=["Leads"])

class SheetImportRequest(BaseModel):
    sheet_url: str

def format_lead(lead: dict) -> dict:
    lead["id"] = str(lead.pop("_id"))
    return lead

@router.post("/", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
async def create_lead(lead: LeadCreate, user: dict = Depends(get_current_user)):
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    lead_dict = lead.model_dump()
    lead_dict["user_email"] = user["email"]
    lead_dict["created_at"] = datetime.utcnow()
    
    result = await leads_collection.insert_one(lead_dict)
    lead_dict["_id"] = result.inserted_id
    
    # Log to Google Sheets
    await sheets_service.log_lead_to_sheet(
        name=lead_dict.get("name") or "N/A",
        email=lead_dict["email"],
        company=lead_dict.get("company", ""),
        notes=lead_dict.get("notes", "")
    )
    
    return format_lead(lead_dict)

@router.get("/", response_model=List[LeadResponse])
async def get_leads(user: dict = Depends(get_current_user)):
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database connection not established")
        
    try:
        leads = []
        cursor = leads_collection.find({"user_email": user["email"]})
        async for document in cursor:
            leads.append(format_lead(document))
        return leads
    except Exception as e:
        print(f"Error fetching leads: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching leads: {str(e)}")


@router.post("/import-sheet-url")
async def import_leads_from_sheet_url(req: SheetImportRequest, user: dict = Depends(get_current_user)):
    """Imports leads directly from a Google Spreadsheet URL into the user's lead database."""
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    if not req.sheet_url or not req.sheet_url.strip():
        raise HTTPException(status_code=400, detail="Google Spreadsheet URL is required")

    try:
        raw_leads = await sheets_service.fetch_leads_from_url(req.sheet_url)
        if not raw_leads:
            raise HTTPException(status_code=400, detail="No valid lead records found in the Google Sheet.")

        imported_count = 0
        skipped_count = 0

        for l in raw_leads:
            email = l["email"].lower().strip()
            # Check for existing lead for this user
            existing = await leads_collection.find_one({
                "user_email": user["email"],
                "email": email
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
        print(f"Error importing from Sheet URL: {e}")
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

    imported_count = 0
    skipped_count = 0

    for r in raw_leads:
        norm = {str(k).strip().lower(): str(v).strip() for k, v in r.items() if k is not None}
        email = next((v for k, v in norm.items() if 'email' in k or 'mail' in k), '')
        if not email or '@' not in email:
            continue

        email = email.lower().strip()
        existing = await leads_collection.find_one({
            "user_email": user["email"],
            "email": email
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
    if leads_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    if not ObjectId.is_valid(lead_id):
        raise HTTPException(status_code=400, detail="Invalid lead ID format")
        
    result = await leads_collection.delete_one({
        "_id": ObjectId(lead_id),
        "user_email": user["email"]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    return None
