"""Explicit Microsoft device login for a local, single-user Azure DevOps session.

Access tokens stay in process memory and are never returned to the browser or model.
Tenant policy may disable this flow; no fallback bypasses Conditional Access.
"""

import os
import re
import time
from uuid import uuid4

import httpx


class LoginError(ValueError):
    pass


class EntraLogin:
    def __init__(self):
        self.pending: dict[str, dict] = {}
        self.access_token: str | None = None
        self.expires_at = 0.0

    def settings(self) -> tuple[str, str]:
        client_id = os.getenv("AZURE_CLIENT_ID", "")
        tenant = os.getenv("AZURE_TENANT_ID", "organizations")
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", tenant) or not re.fullmatch(r"[a-fA-F0-9-]{36}", client_id):
            raise LoginError(
                "Configure AZURE_CLIENT_ID with your Entra app registration ID and AZURE_TENANT_ID."
            )
        if os.getenv("VERCEL"):
            raise LoginError("Device login needs a persistent local process. Use a server token on Vercel.")
        return client_id, f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0"

    def token(self) -> str | None:
        if self.expires_at <= time.time():
            self.access_token = None
        return self.access_token

    def status(self) -> dict:
        return {
            "configured": bool(os.getenv("AZURE_CLIENT_ID")),
            "signed_in": bool(self.token()),
            "expires_at": self.expires_at if self.token() else None,
        }

    async def start(self, transport=None) -> dict:
        client_id, authority = self.settings()
        async with httpx.AsyncClient(timeout=20, transport=transport) as client:
            response = await client.post(
                authority + "/devicecode",
                data={"client_id": client_id, "scope": "499b84ac-1321-427f-aa17-267ca6975798/.default"},
            )
        if response.status_code != 200:
            raise LoginError(
                "Microsoft could not start sign-in. Check the app registration and public client setting."
            )
        data = response.json()
        login_id = uuid4().hex
        now = time.time()
        self.pending = {key: value for key, value in self.pending.items() if value["expires_at"] > now}
        if len(self.pending) >= 5:
            raise LoginError("Too many pending sign-ins. Wait for an earlier request to expire.")
        self.pending[login_id] = {
            "device_code": data["device_code"],
            "expires_at": now + data["expires_in"],
            "next_poll": now + data.get("interval", 5),
            "interval": data.get("interval", 5),
            "client_id": client_id,
            "authority": authority,
        }
        # Use Microsoft's documented user-facing entry point, not an arbitrary response URL.
        return {
            "login_id": login_id,
            "user_code": data["user_code"],
            "verification_uri": "https://microsoft.com/devicelogin",
            "expires_in": data["expires_in"],
            "interval": data.get("interval", 5),
        }

    async def poll(self, login_id: str, transport=None) -> dict:
        flow = self.pending.get(login_id)
        if not flow or flow["expires_at"] <= time.time():
            self.pending.pop(login_id, None)
            return {"status": "expired", "message": "Sign-in expired. Start again."}
        if time.time() < flow["next_poll"]:
            return {"status": "pending", "interval": flow["interval"]}
        flow["next_poll"] = time.time() + flow["interval"]
        async with httpx.AsyncClient(timeout=20, transport=transport) as client:
            response = await client.post(
                flow["authority"] + "/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": flow["client_id"],
                    "device_code": flow["device_code"],
                },
            )
        data = response.json()
        if response.status_code == 200 and "access_token" in data:
            self.access_token = data["access_token"]
            self.expires_at = time.time() + int(data.get("expires_in", 3600)) - 60
            self.pending.pop(login_id, None)
            return {"status": "authenticated"}
        error = data.get("error")
        if error in ("authorization_pending", "slow_down"):
            if error == "slow_down":
                flow["interval"] += 5
                flow["next_poll"] = time.time() + flow["interval"]
            return {"status": "pending", "interval": flow["interval"]}
        self.pending.pop(login_id, None)
        return {
            "status": "failed",
            "message": "Microsoft sign-in was denied or expired. Check tenant policy and consent.",
        }

    def logout(self) -> dict:
        self.access_token = None
        self.expires_at = 0
        self.pending.clear()
        return {"signed_in": False}


entra = EntraLogin()
