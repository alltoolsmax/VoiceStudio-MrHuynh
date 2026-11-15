"""Kiểm tra máy chủ bản quyền PHP từ đầu đến cuối: chạy `php -S` thật với dữ
liệu webhook dạng SePay, khóa ký THỬ (32 byte 0x01) — không phải khóa thật.

Chạy: python -m pytest server/tests  (cần php có sodium + pdo_sqlite).
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "keygen"))
import vsmh_license as lic  # noqa: E402

TEST_PRIVATE = "01" * 32
TEST_PUBLIC = "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"
API_KEY = "test-sepay-key-123"
MACHINE = "VSMH-K4V4-99VS-J484-XGTN"
OTHER_MACHINE = lic.machine_code_from_raw("win:another")
TODAY = "2026-11-15"

pytestmark = pytest.mark.skipif(shutil.which("php") is None, reason="php not installed")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(tmp_path):
    private = tmp_path / "active_private" / "voice_studio2"
    shutil.copytree(ROOT / "server" / "active_private" / "voice_studio2", private)
    config = (private / "config.sample.php").read_text(encoding="utf-8")
    config = config.replace("'private_key' => ''", f"'private_key' => '{TEST_PRIVATE}'")
    config = config.replace("'sepay_api_key' => ''", f"'sepay_api_key' => '{API_KEY}'")
    config = config.replace("'admin_password' => ''", "'admin_password' => 'mat-khau-thu-123'")
    config = config.replace("'ignore_prefixes' => []", "'ignore_prefixes' => ['VAI']")
    (private / "config.php").write_text(config, encoding="utf-8")
    outbox = tmp_path / "telegram.txt"
    port = free_port()
    env = {
        **os.environ,
        "VS2_PRIVATE_DIR": str(private),
        "VS2_TEST_PUBLIC_KEY": TEST_PUBLIC,
        "VS2_TELEGRAM_OUTBOX": str(outbox),
        "VS2_FAKE_NOW": TODAY,
    }
    docroot = tmp_path / "active.mrhuynh.net"
    shutil.copytree(ROOT / "server" / "active.mrhuynh.net", docroot)
    proc = subprocess.Popen(
        ["php", "-S", f"127.0.0.1:{port}", "-t", str(docroot)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            urllib.request.urlopen(base + "/voice_studio2_api.php?action=plans", timeout=1)
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.1)

    class Server:
        url = base
        downloads = docroot / "downloads"

        def call(self, path, body=None, headers=None, method=None):
            data = json.dumps(body).encode() if isinstance(body, dict) else body
            req = urllib.request.Request(base + path, data=data, headers=headers or {}, method=method)
            if isinstance(body, dict):
                req.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return resp.status, json.loads(resp.read() or b"{}")
            except urllib.error.HTTPError as err:
                return err.code, json.loads(err.read() or b"{}")

        def create(self, plan, machine=MACHINE, current_key=None):
            body = {"machine_code": machine, "plan": plan}
            if current_key:
                body["current_key"] = current_key
            return self.call("/voice_studio2_api.php?action=create_order", body)

        def order(self, code, machine=MACHINE):
            q = urllib.parse.urlencode({"action": "order", "code": code, "machine_code": machine})
            return self.call("/voice_studio2_api.php?" + q)

        def pay(self, sepay_id, amount, content, auth=f"Apikey {API_KEY}", code=None):
            payload = {
                "id": sepay_id,
                "gateway": "BIDV",
                "transactionDate": "2026-11-15 10:00:00",
                "accountNumber": "9624788159",
                "subAccount": None,
                "code": code,
                "content": content,
                "transferType": "in",
                "transferAmount": amount,
                "accumulated": 0,
                "referenceCode": f"FT{sepay_id}",
                "description": content,
            }
            headers = {"Authorization": auth} if auth else {}
            return self.call("/voice_studio2_webhook.php", payload, headers)

        def telegram(self):
            return outbox.read_text(encoding="utf-8") if outbox.exists() else ""

    yield Server()
    proc.terminate()
    proc.wait(timeout=5)


def verify(key: str, machine: str = MACHINE):
    """Kiểm tra key như app: chữ ký đúng, đúng máy; trả về (gói, ngày hết hạn)."""
    body = lic.normalize_code(key)[len("VSMH2"):]
    raw = bytearray()
    bits = value = 0
    for ch in body:
        value = (value << 5) | lic.CROCKFORD.index(ch)
        bits += 5
        if bits >= 8:
            raw.append((value >> (bits - 8)) & 0xFF)
            bits -= 8
            value &= (1 << bits) - 1
    payload, signature = bytes(raw[:16]), bytes(raw[16:80])
    Ed25519PublicKey.from_public_bytes(bytes.fromhex(TEST_PUBLIC)).verify(signature, payload)
    assert payload[0] == 2 and payload[2:10] == lic.machine_tag(machine)
    plan = {v: k for k, v in lic.PLAN_TYPES.items()}[payload[1]]
    expiry_day = int.from_bytes(payload[12:14], "big")
    expires = None if expiry_day == 0 else date.fromordinal(lic.ISSUE_EPOCH.toordinal() + expiry_day)
    return plan, expires


def test_php_and_python_sign_identical_keys(tmp_path):
    private = ROOT / "server" / "active_private" / "voice_studio2"
    config = tmp_path / "config.php"
    config.write_text(f"<?php return ['private_key' => '{TEST_PRIVATE}'];", encoding="utf-8")
    script = (
        f"require '{private}/lib.php';"
        f"echo vs2_issue_key('{MACHINE}', 'month1', new DateTimeImmutable('2026-01-31', new DateTimeZone('UTC')), 7)['key'];"
    )
    out = subprocess.run(
        ["php", "-r", script],
        env={**os.environ, "VS2_CONFIG_FILE": str(config), "VS2_TEST_PUBLIC_KEY": TEST_PUBLIC, "VS2_FAKE_NOW": TODAY},
        capture_output=True, text=True, check=True,
    ).stdout
    expected = lic.issue_key(
        lic.load_private_key(TEST_PRIVATE), MACHINE, "month1", date(2026, 1, 31), date(2026, 11, 15), 7
    )
    assert out == expected


def test_plans_list_the_four_prices(server):
    status, data = server.call("/voice_studio2_api.php?action=plans")
    assert status == 200
    assert {p["id"]: p["price"] for p in data["plans"]} == {
        "month1": 55000, "month3": 150000, "year1": 500000, "permanent": 1000000,
    }


def test_bad_input_is_refused(server):
    assert server.create("month1", machine="VSMH-K4V4-99VS-J484-XGTM")[0] == 400  # gõ nhầm
    assert server.create("week1")[0] == 400
    assert server.order("ACTNOPE1234")[0] == 404


def test_full_purchase_with_partial_transfer_and_retry(server):
    status, data = server.create("month1")
    assert status == 200
    order = data["order"]
    code = order["code"]
    assert re.fullmatch(r"ACT[A-Z0-9]{8}", code)
    assert re.search(r"[A-Z]", code[3:]) and re.search(r"[0-9]", code[3:])
    assert order["amount"] == 55000 and order["account"] == "9624788159" and order["bank"] == "BIDV"
    assert "acc=9624788159" in order["qr_url"] and f"des={code}" in order["qr_url"]
    assert "Đơn mới" in server.telegram()
    # Bấm lại cùng gói trong 15 phút: dùng lại đơn cũ.
    assert server.create("month1")[1]["order"]["code"] == code

    # Webhook giả (không có / sai API key) bị từ chối và báo Telegram.
    assert server.pay(1, 55000, code, auth=None)[0] == 401
    assert server.pay(1, 55000, code, auth="Apikey sai")[0] == 401
    assert server.telegram().count("Webhook sai xác thực") == 2
    assert server.order(code)[1]["status"] == "pending"

    # Chuyển thiếu, nội dung viết thường lẫn chữ khác: chưa kích hoạt.
    status, body = server.pay(2, 30000, f"MBVCB.123 {code.lower()} chuyen tien")
    assert (status, body) == (200, {"success": True})
    assert server.order(code)[1]["status"] == "underpaid"
    assert "Chuyển thiếu tiền" in server.telegram()

    # Chuyển thêm cho đủ → cấp key 1 tháng tính từ hôm nay.
    server.pay(3, 25000, code)
    status, result = server.order(code)
    assert result["status"] == "paid" and result["plan"] == "month1"
    assert verify(result["key"]) == ("month1", date(2026, 12, 15))
    assert result["expires_on"] == "2026-12-15"
    assert "Đã thanh toán, đã cấp key" in server.telegram()

    # SePay gửi lại cùng giao dịch: không xử lý hai lần.
    assert server.pay(3, 25000, code) == (200, {"success": True})
    assert server.order(code)[1]["key"] == result["key"]
    # Key chỉ trả về đúng máy đã mua.
    assert server.order(code, machine=OTHER_MACHINE)[0] == 404


def test_renewal_adds_to_the_current_expiry(server):
    first = server.create("month1")[1]["order"]["code"]
    server.pay(10, 55000, first)
    key1 = server.order(first)[1]["key"]

    second = server.create("month3", current_key=key1)[1]["order"]
    assert second["code"] != first
    server.pay(11, 150000, second["code"])
    result = server.order(second["code"])[1]
    assert verify(result["key"]) == ("month3", date(2027, 3, 15))  # 15/12/2026 + 3 tháng

    # Một key giả mạo / của máy khác không làm sai ngày bắt đầu.
    forged = server.create("year1", current_key="VSMH2-" + "A" * 128)[1]["order"]
    server.pay(12, 500000, forged["code"])
    assert verify(server.order(forged["code"])[1]["key"]) == ("year1", date(2028, 3, 15))


def test_permanent_stops_further_purchases(server):
    code = server.create("permanent")[1]["order"]["code"]
    server.pay(20, 1_000_000, f"{code} mua vinh vien")
    key = server.order(code)[1]["key"]
    assert verify(key) == ("permanent", None)
    assert server.create("month1")[0] == 409
    assert server.create("month1", current_key=key)[0] == 409


def test_unmatched_transfers_alert_except_ignored_prefixes(server):
    assert server.pay(30, 99000, "chuyen tien khong ma") == (200, {"success": True})
    assert "Tiền vào không khớp đơn nào" in server.telegram()
    before = server.telegram()
    server.pay(31, 50000, "VAI12345678 thanh toan voice ai")
    assert server.telegram() == before  # tiền của hệ thống khác: bỏ qua


def test_admin_login_and_manual_key(server):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    url = server.url + "/voice_studio2_admin.php"
    page = opener.open(urllib.request.Request(url, data=b"password=sai")).read().decode()
    assert "Sai mật khẩu" in page
    opener.open(urllib.request.Request(url, data=b"password=mat-khau-thu-123")).read()
    page = opener.open(url).read().decode()
    csrf = re.search(r'name="csrf" value="([0-9a-f]+)"', page).group(1)

    # Có đơn QR 1 tháng đã trả → cấp tay 1 năm sẽ cộng dồn từ hạn đó.
    code = server.create("month1")[1]["order"]["code"]
    server.pay(40, 55000, code)
    form = urllib.parse.urlencode({
        "csrf": csrf, "action": "issue", "machine_code": MACHINE.lower(), "plan": "year1",
        "start": "", "amount": "500000", "note": "Khách Zalo",
    }).encode()
    page = opener.open(urllib.request.Request(url, data=form)).read().decode()
    key = re.search(r'<code id="k">([^<]+)</code>', page).group(1)
    assert verify(key) == ("year1", date(2027, 12, 15))
    assert "Khách Zalo" in page

    # Không có CSRF hợp lệ thì không cấp được.
    bad = urllib.parse.urlencode({"csrf": "x", "action": "issue", "machine_code": MACHINE, "plan": "permanent"})
    with pytest.raises(urllib.error.HTTPError):
        opener.open(urllib.request.Request(url, data=bad.encode()))


def test_private_folder_is_not_served(server):
    # php -S không đọc .htaccess, nên chỉ kiểm tra file chặn có tồn tại.
    assert (ROOT / "server" / "active_private" / "voice_studio2" / ".htaccess").is_file()
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(server.url + "/active_private/voice_studio2/config.php")


RELEASE_YML = """version: 1.0.1
files:
  - url: VoiceStudio-MrHuynh-1.0.1-win-x64.exe
    sha512: abc
    size: 3
path: VoiceStudio-MrHuynh-1.0.1-win-x64.exe
sha512: abc
releaseDate: '2026-11-16T10:00:00.000Z'
releaseNotes: |-
  Sửa lỗi lồng tiếng
  Gói mua dễ nhìn hơn
"""


def test_release_page_and_mandatory_update(server):
    # Chưa upload gì: trang tải báo đang cập nhật, không bắt buộc cập nhật.
    page = urllib.request.urlopen(server.url + "/downloads/").read().decode()
    assert "đang được cập nhật" in page
    assert server.call("/voice_studio2_api.php?action=update_policy")[1]["min_version"] == ""

    (server.downloads / "electron-stable-win32-x64.yml").write_text(RELEASE_YML, encoding="utf-8")
    (server.downloads / "VoiceStudio-MrHuynh-1.0.1-win-x64.exe").write_bytes(b"exe")
    page = urllib.request.urlopen(server.url + "/downloads/").read().decode()
    assert 'href="VoiceStudio-MrHuynh-1.0.1-win-x64.exe"' in page
    assert "Gói mua dễ nhìn hơn" in page

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    url = server.url + "/voice_studio2_admin.php"
    opener.open(urllib.request.Request(url, data=b"password=mat-khau-thu-123")).read()
    page = opener.open(url).read().decode()
    assert "<b>1.0.1</b>" in page
    csrf = re.search(r'name="csrf" value="([0-9a-f]+)"', page).group(1)
    form = {"csrf": csrf, "action": "update_policy", "min_version": "1.0.1", "message": "Cập nhật ngay"}
    opener.open(urllib.request.Request(url, data=urllib.parse.urlencode(form).encode())).read()
    status, data = server.call("/voice_studio2_api.php?action=update_policy")
    assert status == 200
    assert (data["min_version"], data["message"], data["latest_version"]) == ("1.0.1", "Cập nhật ngay", "1.0.1")

    # Phiên bản sai dạng thì không lưu.
    form.update(min_version="1.0")
    page = opener.open(urllib.request.Request(url, data=urllib.parse.urlencode(form).encode())).read().decode()
    assert "1.0.1" in server.call("/voice_studio2_api.php?action=update_policy")[1]["min_version"]
