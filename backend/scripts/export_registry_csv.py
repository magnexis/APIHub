from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from private.registry_core import REGISTRY


OUTPUT = ROOT / "data" / "api_registry_rows.csv"

FIELDS = [
    "id",
    "name",
    "category",
    "endpoint",
    "method",
    "description",
    "complexity",
    "auth",
    "requiredTier",
    "family",
    "mode",
    "rateLimitPerMinute",
    "polished",
    "tags",
    "endpointVariants",
    "inputSchema",
    "outputSchema",
    "exampleRequest",
    "exampleResponse",
]


def _dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()

        for api in REGISTRY:
            examples = api.examples or []
            first_example = examples[0] if examples else None
            writer.writerow(
                {
                    "id": api.id,
                    "name": api.name,
                    "category": api.category,
                    "endpoint": api.endpoint,
                    "method": api.method,
                    "description": api.description,
                    "complexity": api.complexity,
                    "auth": api.auth,
                    "requiredTier": api.requiredTier,
                    "family": api.family,
                    "mode": api.mode,
                    "rateLimitPerMinute": api.rateLimitPerMinute,
                    "polished": api.polished,
                    "tags": "|".join(api.tags),
                    "endpointVariants": "|".join(api.endpointVariants),
                    "inputSchema": _dump(api.inputSchema),
                    "outputSchema": _dump(api.outputSchema),
                    "exampleRequest": _dump(first_example.request if first_example else {}),
                    "exampleResponse": _dump(first_example.response if first_example else {}),
                }
            )

    print(f"Wrote {len(REGISTRY)} registry rows to {OUTPUT}")


if __name__ == "__main__":
    main()
