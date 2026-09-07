from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime

class APIKeyModel(BaseModel):
    key_id: str
    name: str
    hashed_key: str
    prefix: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True

class APIKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)

class APIKeyResponse(BaseModel):
    key_id: str
    name: str
    prefix: str
    created_at: datetime
    is_active: bool
    api_key: Optional[str] = None  # Returned ONLY once upon creation

class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = ""
    plan_tier: str = "starter"
    credits_balance: int = 1000
    max_connected_accounts: int = 2
    auth_status: str = "active"
    auth_error: Optional[str] = None
    last_login: Optional[datetime] = None

class UserProfileResponse(BaseModel):
    id: str
    email: str
    name: str
    plan_tier: str = "starter"
    credits_balance: int = 1000
    max_connected_accounts: int = 2
    scopes: List[str] = []
    auth_status: str = "active"
    auth_error: Optional[str] = None
    last_login: Optional[datetime] = None
