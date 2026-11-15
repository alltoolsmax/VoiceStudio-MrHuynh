"""#3581: first-run "Continue" stayed disabled after a custom engine setup.

``/setup/status`` required the default OmniVoice weights even when the user
installed and selected another TTS engine in setup's Advanced view. The
requirement now follows the selected engine, and only a ready engine whose
own catalogue weights are downloaded lifts it.
"""
from __future__ import annotations

import pytest

DEFAULT = "openbmb/VoxCPM2"


class _Ready:
    @classmethod
    def is_available(cls):
        return True, "ready"


class _NotReady:
    @classmethod
    def is_available(cls):
        return False, "not installed"


@pytest.fixture
def setup(monkeypatch):
    """The wizard with nothing but ``cached`` downloaded; returns (wizard, choose)."""
    from api.routers.setup import wizard
    from services import tts_backend

    from services import sidecar_install

    cached: set[str] = set()
    monkeypatch.setattr(wizard, "is_cached", lambda repo_id: repo_id in cached)
    # The default engine's sidecar counts as installed here; its own tests are below.
    monkeypatch.setattr(sidecar_install, "get_status", lambda engine_id: {"installed": True})
    monkeypatch.setattr(wizard, "_disk_free_gb", lambda path: 100.0)

    def choose(engine: str, cls, *, downloaded=()) -> None:
        cached.clear()
        cached.update(downloaded)
        monkeypatch.setattr(tts_backend, "active_backend_id", lambda: engine)
        monkeypatch.setattr(tts_backend, "get_backend_class", lambda backend_id: cls)

    return wizard, choose


def _engine_repo(wizard, engine: str) -> str:
    return next(m["repo_id"] for m in wizard.KNOWN_MODELS if engine in (m.get("engines") or []))


def test_a_ready_custom_engine_lets_first_run_continue(setup):
    wizard, choose = setup
    choose("kittentts", _Ready, downloaded={_engine_repo(wizard, "kittentts")})
    status = wizard.setup_status()
    assert status["models_ready"] is True
    assert status["missing"] == []


def test_an_installed_engine_without_its_weights_keeps_the_requirement(setup):
    wizard, choose = setup
    choose("kittentts", _Ready)
    assert wizard.setup_status()["models_ready"] is False


def test_the_default_engine_still_needs_its_model(setup):
    wizard, choose = setup
    choose("voxcpm2", _Ready)
    status = wizard.setup_status()
    assert status["models_ready"] is False
    assert [m["repo_id"] for m in status["missing"]] == [DEFAULT]


def test_an_unready_or_unknown_choice_keeps_the_requirement(setup, monkeypatch):
    wizard, choose = setup
    choose("kittentts", _NotReady, downloaded={_engine_repo(wizard, "kittentts")})
    assert wizard.setup_status()["models_ready"] is False

    from services import tts_backend

    def unknown(backend_id):
        raise ValueError(backend_id)

    choose("gone", _Ready)
    monkeypatch.setattr(tts_backend, "get_backend_class", unknown)
    assert wizard.setup_status()["models_ready"] is False


# ── Voice Studio - Mr.Huỳnh: first-run setup installs the default VoxCPM2 engine ──


@pytest.fixture
def engine_setup(setup, monkeypatch):
    from services import sidecar_install

    wizard, choose = setup
    started: list[str] = []
    state = {"installed": False}
    monkeypatch.setattr(sidecar_install, "get_status", lambda engine_id: dict(state))
    monkeypatch.setattr(
        sidecar_install, "start_install", lambda engine_id: started.append(engine_id) or {}
    )
    return wizard, choose, started, state


def test_first_run_starts_the_default_engine_install_and_waits_for_it(engine_setup):
    wizard, choose, started, state = engine_setup
    choose("voxcpm2", _NotReady, downloaded={DEFAULT})
    status = wizard.setup_status()
    assert started == ["voxcpm2"]
    assert status["models_ready"] is False
    assert [m["repo_id"] for m in status["missing"]] == ["engine:voxcpm2"]

    state["installed"] = True
    choose("voxcpm2", _Ready, downloaded={DEFAULT})
    status = wizard.setup_status()
    assert status["models_ready"] is True
    assert started == ["voxcpm2"]


def test_another_chosen_engine_never_installs_voxcpm2(engine_setup):
    wizard, choose, started, _state = engine_setup
    choose("kittentts", _Ready, downloaded={_engine_repo(wizard, "kittentts")})
    assert wizard.setup_status()["missing"] == []
    assert started == []


def test_an_unsupported_host_does_not_block_setup_on_the_engine(engine_setup, monkeypatch):
    from services import sidecar_install

    wizard, choose, _started, _state = engine_setup

    def unsupported(engine_id):
        raise sidecar_install.HostUnsupported("no PyTorch build for this host")

    monkeypatch.setattr(sidecar_install, "start_install", unsupported)
    choose("voxcpm2", _NotReady, downloaded={DEFAULT})
    assert all(m["repo_id"] != "engine:voxcpm2" for m in wizard.setup_status()["missing"])
