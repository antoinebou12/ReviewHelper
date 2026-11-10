"""Explicit OAuth device sign-in (Microsoft Entra, GitHub) for a local, single-user session.

Access tokens stay in process memory and are never returned to the browser or model.
Tenant or organization policy may disable this flow; nothing bypasses it.
"""

import os
import re
import time
from uuid import uuid4

import httpx


class LoginError(ValueError):
    pass


class DeviceLogin:
    """RFC 8628 device authorization grant with in-memory tokens."""

    name = "provider"
    client_env = ""
    #: Lifetime used when the token response has no expires_in (GitHub OAuth App tokens).
    default_ttl = 3600

    def __init__(self):
        self.pending: dict[str, dict] = {}
        self.access_token: str | None = None
        self.expires_at = 0.0

    def endpoints(self) -> dict:  # pragma: no cover - overridden
        raise NotImplementedError

    def settings(self) -> dict:
        if os.getenv("VERCEL"):
            raise LoginError("Device login needs a persistent local process. Use a server token on Vercel.")
        return self.endpoints()

    def token(self) -> str | None:
        if self.expires_at <= time.time():
            self.access_token = None
        return self.access_token

    def status(self) -> dict:
        return {
            "configured": bool(os.getenv(self.client_env)),
            "signed_in": bool(self.token()),
            "expires_at": self.expires_at if self.token() else None,
        }

    async def start(self, transport=None) -> dict:
        config = self.settings()
        async with httpx.AsyncClient(timeout=20, transport=transport) as client:
            response = await client.post(
                config["device_url"],
                data={"client_id": config["client_id"], "scope": config["scope"]},
                headers={"Accept": "application/json"},
            )
        data = response.json() if response.status_code == 200 else {}
        if "device_code" not in data:
            raise LoginError(
                f"{self.name} could not start sign-in. Check the app registration and that "
                "device flow is enabled."
            )
        login_id = uuid4().hex
        now = time.time()
        self.pending = {key: value for key, value in self.pending.items() if value["expires_at"] > now}
        if len(self.pending) >= 5:
            raise LoginError("Too many pending sign-ins. Wait for an earlier request to expire.")
        interval = int(data.get("interval", 5))
        self.pending[login_id] = {
            "device_code": data["device_code"],
            "expires_at": now + int(data["expires_in"]),
            "next_poll": now + interval,
            "interval": interval,
            **config,
        }
        # Use the provider's documented entry point, not an arbitrary response URL.
        return {
            "login_id": login_id,
            "user_code": data["user_code"],
            "verification_uri": config["verification_uri"],
            "expires_in": int(data["expires_in"]),
            "interval": interval,
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
                flow["token_url"],
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": flow["client_id"],
                    "device_code": flow["device_code"],
                },
                headers={"Accept": "application/json"},
            )
        data = response.json()
        if response.status_code == 200 and "access_token" in data:
            self.access_token = data["access_token"]
            self.expires_at = time.time() + int(data.get("expires_in", self.default_ttl)) - 60
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
            "message": f"{self.name} sign-in was denied or expired. Check access policy and consent.",
        }

    def logout(self) -> dict:
        self.access_token = None
        self.expires_at = 0
        self.pending.clear()
        return {"signed_in": False}


class EntraLogin(DeviceLogin):
    name = "Microsoft"
    client_env = "AZURE_CLIENT_ID"

    def endpoints(self) -> dict:
        client_id = os.getenv("AZURE_CLIENT_ID", "")
        tenant = os.getenv("AZURE_TENANT_ID", "organizations")
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", tenant) or not re.fullmatch(r"[a-fA-F0-9-]{36}", client_id):
            raise LoginError(
                "Configure AZURE_CLIENT_ID with your Entra app registration ID and AZURE_TENANT_ID."
            )
        authority = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0"
        return {
            "client_id": client_id,
            "device_url": authority + "/devicecode",
            "token_url": authority + "/token",
            # Azure DevOps resource ID.
            "scope": "499b84ac-1321-427f-aa17-267ca6975798/.default",
            "verification_uri": "https://microsoft.com/devicelogin",
        }


class GitHubLogin(DeviceLogin):
    """GitHub App (recommended: fine-grained, read-only) or OAuth App with device flow enabled."""

    name = "GitHub"
    client_env = "GITHUB_CLIENT_ID"
    # OAuth App tokens do not expire; keep the in-memory copy for a working day.
    default_ttl = 8 * 3600

    def endpoints(self) -> dict:
        client_id = os.getenv("GITHUB_CLIENT_ID", "")
        if not re.fullmatch(r"[A-Za-z0-9._-]{8,64}", client_id):
            raise LoginError("Configure GITHUB_CLIENT_ID with your GitHub App or OAuth App client ID.")
        scope = os.getenv("GITHUB_OAUTH_SCOPE", "")
        if not re.fullmatch(r"[a-z:_ ,]*", scope):
            raise LoginError("GITHUB_OAUTH_SCOPE must be a space-separated list such as 'repo'.")
        return {
            "client_id": client_id,
            "device_url": "https://github.com/login/device/code",
            "token_url": "https://github.com/login/oauth/access_token",
            # GitHub Apps ignore scopes and use the app's permissions instead.
            "scope": scope,
            "verification_uri": "https://github.com/login/device",
        }


entra = EntraLogin()
github_login = GitHubLogin()
logins: dict[str, DeviceLogin] = {"azure": entra, "github": github_login}
