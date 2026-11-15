"""Kiểm tra app cấp key khớp định dạng với Voice Studio (codec.test.ts dùng cùng vector)."""
from datetime import date

import pytest

import vsmh_license as lic

TEST_PRIVATE = "01" * 32
TEST_PUBLIC = "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"
RAW_ID = "win:12345678-1234-1234-1234-123456789abc"
MACHINE = "VSMH-K4V4-99VS-J484-XGTN"
KEY = (
    "VSMH1-040TM-Y60RJ-WYHYZ-Z04Z1-14MZ1-CE6QW-YF43C-3V4GW-RPT2J-K4RWJ-ZBD10-FTQB2-"
    "BRS0V-EWVRK-6Y6SC-SCTQE-C3F85-V11F0-ZR009-PGVQF-MRXZK-XF7VE-MGVC6-ZKF06-2BQG0"
)


def test_machine_code_matches_the_app():
    assert lic.machine_code_from_raw(RAW_ID) == MACHINE


def test_key_matches_the_app_vector():
    key = lic.load_private_key(TEST_PRIVATE)
    assert lic.public_key_hex(key) == TEST_PUBLIC
    assert lic.issue_key(key, MACHINE, date(2026, 11, 15), 4242) == KEY


def test_machine_code_input_is_forgiving_but_checked():
    assert lic.parse_machine_code(" vsmh k4v4 99vs j484 xgtn ") == "K4V499VSJ484XGTN"
    assert lic.parse_machine_code("VSMH-K4V4-99VS-J484-XGTM") is None
    with pytest.raises(ValueError):
        lic.issue_key(lic.load_private_key(TEST_PRIVATE), "VSMH-0000")


def test_wrong_private_key_length_is_refused():
    with pytest.raises(ValueError):
        lic.load_private_key("abcd")
