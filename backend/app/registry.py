from __future__ import annotations

try:
    from private.registry_core import *  # type: ignore[F403]
except Exception as exc:  # pragma: no cover - private package is local-only
    raise RuntimeError(
        "Magnexis proprietary registry core is missing. Install the private package or restore private/registry_core.py."
    ) from exc

