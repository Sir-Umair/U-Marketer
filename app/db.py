from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

def get_connection_url(raw_url: str) -> str:
    """
    Ensures robust MongoDB connection.
    If using mongodb+srv on Windows where DNS TXT/SRV resolution is blocked or throttled by local network/ISP,
    this automatically routes to the direct shard replica-set hosts for instant connection.
    """
    if not raw_url:
        return "mongodb://localhost:27017"
        
    if "cluster0.y6udkhq.mongodb.net" in raw_url and raw_url.startswith("mongodb+srv://"):
        return (
            "mongodb://developerumairabrar_db_user:viMhzDrbvO12dU4Y@"
            "ac-pzteteo-shard-00-00.y6udkhq.mongodb.net:27017,"
            "ac-pzteteo-shard-00-01.y6udkhq.mongodb.net:27017,"
            "ac-pzteteo-shard-00-02.y6udkhq.mongodb.net:27017"
            "/email_marketer?ssl=true&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
        )
    return raw_url


class DBManager:
    def __init__(self):
        self._client = None
        self._db = None

    def get_db(self):
        if self._db is None:
            mongo_uri = get_connection_url(settings.mongodb_url)
            print(f"[DB] Initializing MongoDB client connection...")
            self._client = AsyncIOMotorClient(
                mongo_uri,
                serverSelectionTimeoutMS=8000,
                connectTimeoutMS=8000,
                retryWrites=True
            )
            # Extract database name or default to email_marketer
            self._db = self._client.get_database("email_marketer")
        return self._db

_manager = DBManager()

class CollectionProxy:
    def __init__(self, name):
        self.name = name

    def __getattr__(self, item):
        db = _manager.get_db()
        collection = db[self.name]
        return getattr(collection, item)

# We export 'db' as a proxy as well in case it's used directly
class DBProxy:
    def __getattr__(self, item):
        db = _manager.get_db()
        return getattr(db, item)

db = DBProxy()

# Export all collections using the proxy so they don't block import
users_collection = CollectionProxy("users")
leads_collection = CollectionProxy("leads")
email_logs_collection = CollectionProxy("email_logs")
settings_collection = CollectionProxy("settings")
follow_ups_collection = CollectionProxy("follow_ups")
