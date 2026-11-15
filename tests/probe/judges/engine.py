"""Engine-matrix judges — verify the TTS/ASR backend registry (the engine
compatibility hard constraint). Operate on a ``/engines/{family}`` payload
(``{active, backends:[{id, available, reason}, ...]}``) captured from the app.
"""

from __future__ import annotations

from typing import Any

from ..spec import JudgeResult


def _backends(payload: Any) -> list:
    return list((payload or {}).get("backends") or [])


def engines_present(payload: dict, min_count: int = 1) -> JudgeResult:
    n = len(_backends(payload))
    return JudgeResult(
        name="engines_present",
        passed=n >= int(min_count),
        measured=n,
        detail=f"{n} backend(s) registered (min {min_count})",
    )


SETUP_INSTALLED_DEFAULTS = frozenset({"voxcpm2"})


def active_engine_available(payload: dict) -> JudgeResult:
    """The default/active engine must actually be available — otherwise the app
    boots pointing at an engine that can't synthesize."""
    active = (payload or {}).get("active")
    match = next((b for b in _backends(payload) if b.get("id") == active), None)
    ok = bool(match) and bool(match.get("available"))
    # Voice Studio - Mr.Huỳnh: the default VoxCPM2 engine is registered on a
    # fresh boot but only becomes available once first-run setup has installed
    # it (setup waits for that install), so registered-and-explained passes.
    setup_installed = (
        not ok and bool(match) and active in SETUP_INSTALLED_DEFAULTS and bool(match.get("reason"))
    )
    return JudgeResult(
        name="active_engine_available",
        passed=ok or setup_installed,
        measured=active,
        detail=f"active engine {active!r} available" if ok
        else f"active engine {active!r} is installed by first-run setup" if setup_installed
        else f"active engine {active!r} is NOT available/registered",
    )


def engine_available(payload: dict, engine_id: str) -> JudgeResult:
    b = next((b for b in _backends(payload) if b.get("id") == engine_id), None)
    ok = bool(b) and bool(b.get("available"))
    return JudgeResult(
        name="engine_available",
        passed=ok,
        measured=engine_id,
        detail=f"{engine_id!r} available" if ok else f"{engine_id!r} unavailable/missing",
    )


def unavailable_engines_explained(payload: dict) -> JudgeResult:
    """Every unavailable engine must carry a non-empty ``reason`` — that's how the
    user learns what to install. A silent unavailable engine is a UX bug."""
    silent = [
        b.get("id") for b in _backends(payload)
        if not b.get("available") and not (b.get("reason") or "").strip()
    ]
    return JudgeResult(
        name="unavailable_engines_explained",
        passed=not silent,
        measured=len(silent),
        detail="every unavailable engine explains why" if not silent
        else f"unavailable engines with no reason: {silent}",
    )
