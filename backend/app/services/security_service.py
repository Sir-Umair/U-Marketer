from cryptography.fernet import Fernet
from app.config import settings
import base64
import os

# Initialize Fernet with ENCRYPTION_KEY or generate a temporary one if not provided
def get_fernet():
    key = settings.encryption_key
    if not key:
        # Fallback for development if no key is set
        print("WARNING: ENCRYPTION_KEY not set in .env. Using a temporary key.")
        # In a real app, this should be a stable key from environment
        return Fernet(Fernet.generate_key())
    
    # Ensure key is in correct format (32 bytes base64 encoded)
    try:
        return Fernet(key.encode())
    except Exception:
        print("ERROR: Invalid ENCRYPTION_KEY format. Must be a 32-byte base64 string.")
        return Fernet(Fernet.generate_key())

fernet = get_fernet()

def encrypt_data(data: str) -> str:
    if not data:
        return ""
    return fernet.encrypt(data.encode()).decode()

def decrypt_data(encrypted_data: str) -> str:
    if not encrypted_data:
        return ""
    try:
        return fernet.decrypt(encrypted_data.encode()).decode()
    except Exception as e:
        print(f"Decryption error: {e}")
        return ""

def generate_key():
    """Utility to generate a new encryption key for .env"""
    return Fernet.generate_key().decode()
