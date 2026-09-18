from pydantic import BaseModel, EmailStr, Field
from typing import List
from datetime import datetime

class LeadCreate(BaseModel):
    email: EmailStr
    name: str = ""
    company: str = ""
    notes: str = ""
    tags: List[str] = []
    status: str = "active"

class LeadResponse(LeadCreate):
    id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
