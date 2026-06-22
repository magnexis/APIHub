from __future__ import annotations

import csv
import math
import sys
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from private.registry_core import REGISTRY


OUTPUT_DIR = ROOT / "data" / "registry_csv_parts"
FIELDS = [
    "Item Name",
    "SKU",
    "Categories",
    "Permalink",
    "Option Value 1",
    "Description",
    "Option Value 2",
    "Option Value 3",
    "Option Value 4",
    "Reporting Category",
    "Variation Name",
    "Option Value 5",
    "Option Value 6",
    "Price",
]


def _price_for(api_id: str, index: int) -> str:
    digest = sha256(api_id.encode("utf-8")).hexdigest()
    cents = 99 + (index % 5000) + (int(digest[:4], 16) % 97)
    return f"{cents / 100:.2f}"


def _slug(value: str) -> str:
    return value.strip("/").replace("/", "-")


def _chunk(items: list[tuple[int, object]], parts: int) -> list[list[tuple[int, object]]]:
    size = math.ceil(len(items) / parts)
    return [items[index : index + size] for index in range(0, len(items), size)]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    parts = _chunk(list(enumerate(REGISTRY)), 3)

    for index, chunk in enumerate(parts, start=1):
        output = OUTPUT_DIR / f"api_registry_rows_part{index}.csv"
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            for global_index, api in chunk:
                writer.writerow(
                    {
                        "Item Name": api.name,
                        "SKU": api.id,
                        "Categories": f"Magnexis APIHub > {api.category.title()}",
                        "Permalink": _slug(api.endpoint),
                        "Option Value 1": api.category,
                        "Description": api.description,
                        "Option Value 2": api.complexity,
                        "Option Value 3": api.auth,
                        "Option Value 4": api.requiredTier,
                        "Reporting Category": api.family.replace("-", " ").title(),
                        "Variation Name": api.mode,
                        "Option Value 5": "|".join(api.tags[:2]) if api.tags else api.family,
                        "Option Value 6": str(api.rateLimitPerMinute),
                        "Price": _price_for(api.id, global_index),
                    }
                )
        print(f"Wrote {len(chunk)} rows to {output}")


if __name__ == "__main__":
    main()
