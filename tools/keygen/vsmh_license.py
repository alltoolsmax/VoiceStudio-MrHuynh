"""Định dạng mã máy và key bản quyền Voice Studio - Mr.Huỳnh.

Phải khớp từng byte với electron/src/main/license/codec.ts (bộ test ghép cặp
tools/keygen/test_vsmh_license.py và electron/src/main/license/codec.test.ts
kiểm tra điều này).
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import date, datetime, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
MACHINE_PREFIX = "VSMH"
KEY_PREFIX = "VSMH1"
KEY_VERSION = 1
LICENSE_TYPE_PERMANENT = 1
ISSUE_EPOCH = date(2026, 1, 1)


def base32_encode(data: bytes) -> str:
    bits = value = 0
    out = []
    for byte in data:
        value = (value << 8) | byte
        bits += 8
        while bits >= 5:
            out.append(CROCKFORD[(value >> (bits - 5)) & 31])
            bits -= 5
        value &= (1 << bits) - 1
    if bits:
        out.append(CROCKFORD[(value << (5 - bits)) & 31])
    return "".join(out)


def normalize_code(text: str) -> str:
    text = text.upper()
    for ch in " \t\r\n-_.":
        text = text.replace(ch, "")
    return text.replace("O", "0").replace("I", "1").replace("L", "1")


def _checksum_char(data: str) -> str:
    return CROCKFORD[sum((i + 1) * CROCKFORD.index(c) for i, c in enumerate(data)) % 32]


def machine_code_from_raw(raw_id: str) -> str:
    digest = hashlib.sha256(f"VSMH-MACHINE-v1|{raw_id}".encode()).digest()
    data = base32_encode(digest[:10])[:15]
    body = data + _checksum_char(data)
    return f"{MACHINE_PREFIX}-" + "-".join(body[i:i + 4] for i in range(0, 16, 4))


def parse_machine_code(text: str) -> str | None:
    """16 ký tự lõi của mã máy, hoặc None khi sai định dạng / sai ký tự kiểm tra."""
    body = normalize_code(text)
    if body.startswith(MACHINE_PREFIX):
        body = body[len(MACHINE_PREFIX):]
    if len(body) != 16 or any(c not in CROCKFORD for c in body):
        return None
    return body if _checksum_char(body[:15]) == body[15] else None


def format_machine_code(body: str) -> str:
    return f"{MACHINE_PREFIX}-" + "-".join(body[i:i + 4] for i in range(0, 16, 4))


def machine_tag(machine_code: str) -> bytes:
    body = parse_machine_code(machine_code)
    if body is None:
        raise ValueError("Mã máy không hợp lệ")
    return hashlib.sha256(f"VSMH-KEY-v1|{body}".encode()).digest()[:8]


def load_private_key(text: str) -> Ed25519PrivateKey:
    raw = bytes.fromhex(text.strip())
    if len(raw) != 32:
        raise ValueError("Khóa bí mật phải là 64 ký tự hex")
    return Ed25519PrivateKey.from_private_bytes(raw)


def public_key_hex(private_key: Ed25519PrivateKey) -> str:
    return private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    ).hex()


def issue_key(
    private_key: Ed25519PrivateKey,
    machine_code: str,
    issued: date | None = None,
    serial: int | None = None,
) -> str:
    """Tạo key vĩnh viễn cho một mã máy."""
    issued = issued or datetime.now(timezone.utc).date()
    day = (issued - ISSUE_EPOCH).days
    if not 0 <= day <= 0xFFFF:
        raise ValueError("Ngày cấp nằm ngoài phạm vi")
    serial = secrets.randbelow(0x10000) if serial is None else serial
    payload = (
        bytes([KEY_VERSION, LICENSE_TYPE_PERMANENT])
        + machine_tag(machine_code)
        + day.to_bytes(2, "big")
        + serial.to_bytes(2, "big")
    )
    signature = private_key.sign(payload)
    body = base32_encode(payload + signature)
    return f"{KEY_PREFIX}-" + "-".join(body[i:i + 5] for i in range(0, len(body), 5))
