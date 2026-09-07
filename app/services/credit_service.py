from fastapi import HTTPException, status
from app.db import users_collection
from datetime import datetime

class CreditService:
    async def deduct_credits(self, user_email: str, cost: int, operation_type: str) -> dict:
        """
        Deducts credits atomically from a user's organization balance.
        Raises HTTP 402 (Payment Required) if the user has insufficient credits.
        """
        if users_collection is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database connection not available"
            )

        user = await users_collection.find_one({"email": user_email})
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User account '{user_email}' not found"
            )

        raw_balance = user.get("credits_balance")
        current_balance = 1000 if raw_balance is None else raw_balance

        if current_balance < cost:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Insufficient credits for {operation_type}. Required: {cost} credits, Available: {current_balance} credits. Please upgrade your plan or top up credits."
            )

        # Atomic decrement, ensuring field is initialized if it was None
        result = await users_collection.update_one(
            {"email": user_email, "$or": [{"credits_balance": {"$gte": cost}}, {"credits_balance": None}]},
            {"$set": {"credits_balance": current_balance - cost}}
        )

        if result.modified_count == 0:
            # Re-fetch latest balance for error message
            latest_user = await users_collection.find_one({"email": user_email})
            latest_balance = latest_user.get("credits_balance", 0) if latest_user else 0
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Insufficient credits for {operation_type}. Available: {latest_balance} credits."
            )

        new_balance = current_balance - cost
        print(f"[CreditService] Deducted {cost} credits from {user_email} for '{operation_type}'. Remaining: {new_balance}")

        return {
            "success": True,
            "deducted": cost,
            "remaining_credits": new_balance,
            "operation": operation_type
        }

credit_service = CreditService()
