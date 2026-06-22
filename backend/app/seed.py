from __future__ import annotations

import json
from pathlib import Path

from .registry import REGISTRY


def main() -> None:
    out_dir = Path(__file__).resolve().parents[1] / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "registry.json").write_text(json.dumps([item.model_dump() for item in REGISTRY], indent=2), encoding="utf-8")
    print(f"Wrote {len(REGISTRY)} API definitions to {out_dir / 'registry.json'}")


if __name__ == "__main__":
    main()

