"""
ConfigStore — local, encrypted persistence of provider settings and API keys.

The config blob (active provider + per-provider keys) is encrypted with
`cryptography.fernet.Fernet`. The key is securely stored in `~/.nexus/.secret_key`
with POSIX 0600 permissions (user read/write only).

This avoids intrusive OS Keychain password prompts on macOS while keeping
API keys encrypted at rest.
"""

import json
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class ConfigStore:
    def __init__(self, config_dir: Path | None = None) -> None:
        self.config_dir = config_dir or Path.home() / ".nexus"
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.config_dir / "config.enc"
        self._fernet = self._load_or_create_fernet()

    def _load_or_create_fernet(self) -> Fernet:
        key_path = self.config_dir / ".secret_key"
        key: str | None = None

        if key_path.exists():
            try:
                key = key_path.read_text().strip()
            except Exception:
                key = None

        # Check existing fallback key file if migrating
        fallback_key_path = self.config_dir / ".keyring_fallback"
        if not key and fallback_key_path.exists():
            try:
                key = fallback_key_path.read_text().strip()
            except Exception:
                pass

        if not key:
            key = Fernet.generate_key().decode("utf-8")
            try:
                key_path.write_text(key)
                key_path.chmod(0o600)
            except Exception:
                pass

        return Fernet(key.encode("utf-8"))

    def _read(self) -> dict:
        if not self.config_path.exists():
            return {"active_provider": None, "keys": {}}

        encrypted = self.config_path.read_bytes()
        try:
            decrypted = self._fernet.decrypt(encrypted)
        except InvalidToken:
            # Config was encrypted with a different key (or is corrupt) —
            # treat it as absent rather than crashing the app.
            return {"active_provider": None, "keys": {}}

        return json.loads(decrypted.decode("utf-8"))

    def _write(self, data: dict) -> None:
        payload = json.dumps(data).encode("utf-8")
        encrypted = self._fernet.encrypt(payload)
        self.config_path.write_bytes(encrypted)
        try:
            self.config_path.chmod(0o600)
        except Exception:
            pass

    def get_active_provider(self) -> str | None:
        return self._read().get("active_provider")

    def save_provider_key(self, provider: str, api_key: str) -> None:
        data = self._read()
        data.setdefault("keys", {})[provider] = api_key
        data["active_provider"] = provider
        self._write(data)

    def get_provider_key(self, provider: str) -> str | None:
        return self._read().get("keys", {}).get(provider)

    def clear(self) -> None:
        if self.config_path.exists():
            self.config_path.unlink()
