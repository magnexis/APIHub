from __future__ import annotations

import json
import logging
import os
import sqlite3
import urllib.request
import urllib.error
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

_logger = logging.getLogger(__name__)

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - optional dependency during local-only installs
    psycopg = None
    dict_row = None

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_APP_DATA_DIR = Path(os.getenv("LOCALAPPDATA", str(BASE_DIR))) / "Magnexis APIHub"
DATA_DIR = Path(os.getenv("MAGNEXIS_DATA_DIR", str(DEFAULT_APP_DATA_DIR / "data")))
SQLITE_PATH = DATA_DIR / "magnexis.sqlite3"


def using_postgres() -> bool:
    storage_mode = os.getenv("MAGNEXIS_STORAGE", "").strip().lower()
    if storage_mode:
        return storage_mode == "postgres"
    return bool(os.getenv("POSTGRES_URL", "").strip())


def _connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if using_postgres():
        if psycopg is None:
            raise RuntimeError("psycopg is required when POSTGRES_URL is set")
        dsn = os.getenv("POSTGRES_URL", "").strip()
        return psycopg.connect(dsn, row_factory=dict_row)
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def db() -> Iterator[Any]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _execute(conn: Any, sql: str, params: tuple[Any, ...] = ()) -> Any:
    if using_postgres():
        sql = sql.replace("?", "%s")
    return conn.execute(sql, params)


def _fetch_rows(cursor: Any) -> list[dict[str, Any]]:
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


def _now() -> str:
    return datetime.utcnow().isoformat()


def init_db() -> None:
    if using_postgres():
        schema = """
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          color TEXT,
          items TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS executions (
          id BIGSERIAL PRIMARY KEY,
          api_id TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          latency_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          request_body TEXT NOT NULL,
          response_body TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recent_searches (
          id BIGSERIAL PRIMARY KEY,
          query TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
          api_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_requests (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          api_id TEXT NOT NULL,
          method TEXT NOT NULL,
          body TEXT NOT NULL,
          headers TEXT NOT NULL,
          query TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS checkout_receipts (
          id TEXT PRIMARY KEY,
          receipt_number TEXT NOT NULL,
          api_id TEXT NOT NULL,
          api_name TEXT NOT NULL,
          tier TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL,
          checkout_url TEXT NOT NULL,
          status TEXT NOT NULL,
          provider TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          payment_token TEXT
        );

        CREATE TABLE IF NOT EXISTS onboarding (
          id INTEGER PRIMARY KEY,
          completed INTEGER NOT NULL DEFAULT 0,
          interests TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account (
          id INTEGER PRIMARY KEY,
          display_name TEXT NOT NULL,
          email TEXT NOT NULL,
          api_coin_balance INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    else:
        schema = """
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          color TEXT,
          items TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS executions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          api_id TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          latency_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          request_body TEXT NOT NULL,
          response_body TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recent_searches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
          api_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_requests (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          api_id TEXT NOT NULL,
          method TEXT NOT NULL,
          body TEXT NOT NULL,
          headers TEXT NOT NULL,
          query TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS checkout_receipts (
          id TEXT PRIMARY KEY,
          receipt_number TEXT NOT NULL,
          api_id TEXT NOT NULL,
          api_name TEXT NOT NULL,
          tier TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL,
          checkout_url TEXT NOT NULL,
          status TEXT NOT NULL,
          provider TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          payment_token TEXT
        );

        CREATE TABLE IF NOT EXISTS onboarding (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          completed INTEGER NOT NULL DEFAULT 0,
          interests TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          display_name TEXT NOT NULL,
          email TEXT NOT NULL,
          api_coin_balance INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    with db() as conn:
        if using_postgres():
            for statement in [part.strip() for part in schema.split(";") if part.strip()]:
                conn.execute(statement)
            # Migration: add payment_token column if missing
            cols = {r[0] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'checkout_receipts'"
            ).fetchall()}
            if "payment_token" not in cols:
                conn.execute("ALTER TABLE checkout_receipts ADD COLUMN payment_token TEXT")
        else:
            conn.executescript(schema)
            # Migration: add payment_token column if missing
            col_names = {r[1] for r in conn.execute("PRAGMA table_info(checkout_receipts)").fetchall()}
            if "payment_token" not in col_names:
                conn.execute("ALTER TABLE checkout_receipts ADD COLUMN payment_token TEXT")
        now = _now()
        if using_postgres():
            _execute(conn, "INSERT INTO onboarding (id, completed, interests, created_at, updated_at) VALUES (1, 0, '[]', ?, ?) ON CONFLICT (id) DO NOTHING", (now, now))
            _execute(
                conn,
                "INSERT INTO account (id, display_name, email, api_coin_balance, created_at, updated_at) VALUES (1, 'Unregistered', '', 0, ?, ?) ON CONFLICT (id) DO NOTHING",
                (now, now),
            )
            defaults = {
                "theme": "light",
                "response_format": "json",
                "local_port": 8787,
                "auto_save_requests": True,
                "telemetry": False,
                "compact_mode": False,
                "subscription_tier": "free",
            }
            for key, value in defaults.items():
                _execute(conn, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", (key, json.dumps(value)))
        else:
            _execute(conn, "INSERT OR IGNORE INTO onboarding (id, completed, interests, created_at, updated_at) VALUES (1, 0, '[]', ?, ?)", (now, now))
            _execute(conn, "INSERT OR IGNORE INTO account (id, display_name, email, api_coin_balance, created_at, updated_at) VALUES (1, 'Unregistered', '', 0, ?, ?)", (now, now))
            defaults = {
                "theme": "light",
                "response_format": "json",
                "local_port": 8787,
                "auto_save_requests": True,
                "telemetry": False,
                "compact_mode": False,
                "subscription_tier": "free",
            }
            for key, value in defaults.items():
                _execute(conn, "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))


def _receipt_prefix(provider: str) -> str:
    return provider.upper().replace(" ", "")[:6] or "MAG"


def create_checkout_receipt(
    *,
    api_id: str,
    api_name: str,
    tier: str,
    amount_cents: int,
    currency: str,
    checkout_url: str,
    provider: str = "square",
) -> dict[str, Any]:
    now = _now()
    receipt_id = f"rcpt-{uuid.uuid4().hex[:12]}"
    receipt_number = f"{_receipt_prefix(provider)}-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "id": receipt_id,
        "receiptNumber": receipt_number,
        "apiId": api_id,
        "apiName": api_name,
        "tier": tier,
        "amountCents": amount_cents,
        "currency": currency,
        "checkoutUrl": checkout_url,
        "status": "pending",
        "provider": provider,
        "createdAt": now,
        "updatedAt": now,
        "completedAt": None,
    }
    with db() as conn:
        if using_postgres():
            _execute(
                conn,
                "INSERT INTO checkout_receipts (id, receipt_number, api_id, api_name, tier, amount_cents, currency, checkout_url, status, provider, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    receipt_id,
                    receipt_number,
                    api_id,
                    api_name,
                    tier,
                    amount_cents,
                    currency,
                    checkout_url,
                    "pending",
                    provider,
                    now,
                    now,
                    None,
                ),
            )
        else:
            _execute(
                conn,
                "INSERT OR REPLACE INTO checkout_receipts (id, receipt_number, api_id, api_name, tier, amount_cents, currency, checkout_url, status, provider, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    receipt_id,
                    receipt_number,
                    api_id,
                    api_name,
                    tier,
                    amount_cents,
                    currency,
                    checkout_url,
                    "pending",
                    provider,
                    now,
                    now,
                    None,
                ),
            )
    return payload


def _verify_square_payment(payment_token: str, expected_amount_cents: int) -> dict[str, Any]:
    """Verify a payment with the Square Payments API.

    Requires SQUARE_ACCESS_TOKEN env var.  Returns the parsed payment
    JSON on success or raises ValueError / RuntimeError.
    """
    access_token = os.getenv("SQUARE_ACCESS_TOKEN", "").strip()
    if not access_token:
        raise RuntimeError(
            "SQUARE_ACCESS_TOKEN is not configured; cannot verify payments"
        )
    url = f"https://connect.squareup.com/v2/payments/{payment_token}"
    req = urllib.request.Request(url, headers={
        "Square-Version": "2025-04-16",
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise ValueError(f"Square verification failed (HTTP {exc.code}): {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Square API: {exc}") from exc

    payment = data.get("payment", {})
    status = payment.get("status", "")
    amount_money = payment.get("amount_money", {})
    actual_cents = int(amount_money.get("amount", 0))

    if status != "COMPLETED":
        raise ValueError(f"Payment {payment_token} is not completed (status={status})")
    if actual_cents != expected_amount_cents:
        raise ValueError(
            f"Payment amount mismatch: expected {expected_amount_cents} cents, got {actual_cents} cents"
        )
    return data


def complete_checkout_receipt(receipt_id: str, payment_token: str = "") -> dict[str, Any] | None:
    now = _now()
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM checkout_receipts WHERE id = ?", (receipt_id,)))
        if not rows:
            return None
        row = rows[0]
        if row["status"] == "paid":
            return get_checkout_receipt(receipt_id)

        # Verify payment with Square before marking as paid
        token = payment_token.strip()
        if not token:
            raise ValueError("paymentToken is required to complete checkout")
        try:
            _verify_square_payment(token, int(row["amount_cents"]))
        except (ValueError, RuntimeError) as exc:
            _logger.warning("Payment verification failed for receipt %s: %s", receipt_id, exc)
            raise

        _execute(conn, "UPDATE checkout_receipts SET status = ?, updated_at = ?, completed_at = ?, payment_token = ? WHERE id = ?", ("paid", now, now, token, receipt_id))
        _execute(conn, "UPDATE settings SET value = ? WHERE key = 'subscription_tier'", (json.dumps(row["tier"]),))
    return get_checkout_receipt(receipt_id)


def get_checkout_receipt(receipt_id: str) -> dict[str, Any] | None:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM checkout_receipts WHERE id = ?", (receipt_id,)))
    if not rows:
        return None
    row = rows[0]
    return {
        "id": row["id"],
        "receiptNumber": row["receipt_number"],
        "apiId": row["api_id"],
        "apiName": row["api_name"],
        "tier": row["tier"],
        "amountCents": int(row["amount_cents"]),
        "currency": row["currency"],
        "checkoutUrl": row["checkout_url"],
        "status": row["status"],
        "provider": row["provider"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "completedAt": row.get("completed_at"),
    }


def get_checkout_receipts(limit: int = 25) -> list[dict[str, Any]]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM checkout_receipts ORDER BY created_at DESC LIMIT ?", (limit,)))
    return [
        {
            "id": row["id"],
            "receiptNumber": row["receipt_number"],
            "apiId": row["api_id"],
            "apiName": row["api_name"],
            "tier": row["tier"],
            "amountCents": int(row["amount_cents"]),
            "currency": row["currency"],
            "checkoutUrl": row["checkout_url"],
            "status": row["status"],
            "provider": row["provider"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "completedAt": row.get("completed_at"),
        }
        for row in rows
    ]


def seed_collection_rows(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        save_collection(row)


def seed_workflow_rows(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        save_workflow(row)


def get_settings() -> dict[str, Any]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT key, value FROM settings"))
    settings = {row["key"]: json.loads(row["value"]) for row in rows}
    settings.setdefault("subscription_tier", "free")
    settings["subscription_tier"] = get_paid_subscription_tier()
    return settings


def _tier_rank(tier: str) -> int:
    order = {"free": 0, "pro": 1, "enterprise": 2}
    return order.get(str(tier).strip().lower(), 0)


def get_paid_subscription_tier() -> str:
    with db() as conn:
        rows = _fetch_rows(
            _execute(
                conn,
                "SELECT tier FROM checkout_receipts WHERE status = 'paid' ORDER BY updated_at DESC, created_at DESC",
            )
        )
    if not rows:
        return "free"
    return max((str(row["tier"]).strip().lower() for row in rows), key=_tier_rank, default="free")


def update_settings(payload: dict[str, Any]) -> dict[str, Any]:
    effective_tier = get_paid_subscription_tier()
    with db() as conn:
        for key, value in payload.items():
            if key == "subscription_tier":
                value = effective_tier
            if using_postgres():
                _execute(conn, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (key, json.dumps(value)))
            else:
                _execute(conn, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    return get_settings()


def get_collections() -> list[dict[str, Any]]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM collections ORDER BY updated_at DESC, name ASC"))
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "description": row.get("description"),
            "color": row.get("color"),
            "items": json.loads(row["items"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def save_collection(payload: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    with db() as conn:
        existing = _fetch_rows(_execute(conn, "SELECT created_at FROM collections WHERE id = ?", (payload["id"],)))
        created_at = existing[0]["created_at"] if existing else now
        if using_postgres():
            _execute(conn, "DELETE FROM collections WHERE id = ?", (payload["id"],))
            _execute(
                conn,
                "INSERT INTO collections (id, name, description, color, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    payload["id"],
                    payload["name"],
                    payload.get("description"),
                    payload.get("color", "blue"),
                    json.dumps(payload.get("items", [])),
                    created_at,
                    now,
                ),
            )
        else:
            _execute(
                conn,
                "INSERT OR REPLACE INTO collections (id, name, description, color, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    payload["id"],
                    payload["name"],
                    payload.get("description"),
                    payload.get("color", "blue"),
                    json.dumps(payload.get("items", [])),
                    created_at,
                    now,
                ),
            )
    return payload | {"createdAt": created_at, "updatedAt": now}


def delete_collection(collection_id: str) -> None:
    with db() as conn:
        _execute(conn, "DELETE FROM collections WHERE id = ?", (collection_id,))


def get_workflows() -> list[dict[str, Any]]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM workflows ORDER BY updated_at DESC, name ASC"))
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "description": row.get("description"),
            "steps": json.loads(row["steps"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def save_workflow(payload: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    with db() as conn:
        existing = _fetch_rows(_execute(conn, "SELECT created_at FROM workflows WHERE id = ?", (payload["id"],)))
        created_at = existing[0]["created_at"] if existing else now
        if using_postgres():
            _execute(conn, "DELETE FROM workflows WHERE id = ?", (payload["id"],))
            _execute(
                conn,
                "INSERT INTO workflows (id, name, description, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    payload["id"],
                    payload["name"],
                    payload.get("description"),
                    json.dumps(payload.get("steps", [])),
                    created_at,
                    now,
                ),
            )
        else:
            _execute(
                conn,
                "INSERT OR REPLACE INTO workflows (id, name, description, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    payload["id"],
                    payload["name"],
                    payload.get("description"),
                    json.dumps(payload.get("steps", [])),
                    created_at,
                    now,
                ),
            )
    return payload | {"createdAt": created_at, "updatedAt": now}


def add_execution(api_id: str, endpoint: str, status_code: int, latency_ms: int, request_body: dict[str, Any], response_body: dict[str, Any]) -> None:
    with db() as conn:
        _execute(
            conn,
            "INSERT INTO executions (api_id, endpoint, status_code, latency_ms, created_at, request_body, response_body) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (api_id, endpoint, status_code, latency_ms, _now(), json.dumps(request_body), json.dumps(response_body)),
        )


def get_executions(limit: int = 100) -> list[dict[str, Any]]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM executions ORDER BY id DESC LIMIT ?", (limit,)))
    return [
        {
            "id": row["id"],
            "apiId": row["api_id"],
            "endpoint": row["endpoint"],
            "statusCode": row["status_code"],
            "latencyMs": row["latency_ms"],
            "createdAt": row["created_at"],
            "requestBody": json.loads(row["request_body"]),
            "responseBody": json.loads(row["response_body"]),
        }
        for row in rows
    ]


def count_recent_executions(api_id: str, window_seconds: int = 60) -> int:
    since = (datetime.utcnow() - timedelta(seconds=window_seconds)).isoformat()
    with db() as conn:
        row = _fetch_rows(
            _execute(
                conn,
                "SELECT COUNT(*) AS count FROM executions WHERE api_id = ? AND created_at >= ?",
                (api_id, since),
            )
        )[0]
    return int(row["count"])


def add_recent_search(query: str) -> None:
    with db() as conn:
        _execute(conn, "INSERT INTO recent_searches (query, created_at) VALUES (?, ?)", (query, _now()))


def get_recent_searches(limit: int = 10) -> list[str]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT query FROM recent_searches ORDER BY id DESC LIMIT ?", (limit,)))
    return [row["query"] for row in rows]


def toggle_favorite(api_id: str) -> bool:
    with db() as conn:
        existing = _fetch_rows(_execute(conn, "SELECT api_id FROM favorites WHERE api_id = ?", (api_id,)))
        if existing:
            _execute(conn, "DELETE FROM favorites WHERE api_id = ?", (api_id,))
            return False
        _execute(conn, "INSERT INTO favorites (api_id, created_at) VALUES (?, ?)", (api_id, _now()))
        return True


def get_favorites() -> list[str]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT api_id FROM favorites ORDER BY created_at DESC"))
    return [row["api_id"] for row in rows]


def get_onboarding() -> dict[str, Any]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM onboarding WHERE id = 1"))
    row = rows[0]
    return {
        "completed": bool(row["completed"]),
        "interests": json.loads(row["interests"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_account() -> dict[str, Any]:
    init_db()
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM account WHERE id = 1"))
    row = rows[0]
    has_signed_up = row["display_name"] != "Unregistered" or bool(row["email"])
    return {
        "signedUp": has_signed_up,
        "displayName": row["display_name"],
        "email": row["email"],
        "apiCoinBalance": int(row["api_coin_balance"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def sign_up_account(display_name: str, email: str) -> dict[str, Any]:
    init_db()
    now = _now()
    balance = 1
    with db() as conn:
        if using_postgres():
            _execute(
                conn,
                "INSERT INTO account (id, display_name, email, api_coin_balance, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, api_coin_balance = EXCLUDED.api_coin_balance, updated_at = EXCLUDED.updated_at",
                (display_name, email, balance, now, now),
            )
        else:
            _execute(
                conn,
                "INSERT OR REPLACE INTO account (id, display_name, email, api_coin_balance, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)",
                (display_name, email, balance, now, now),
            )
    return get_account()


def get_api_coin_balance() -> int:
    init_db()
    return int(get_account()["apiCoinBalance"])


def spend_api_coin() -> bool:
    init_db()
    now = _now()
    with db() as conn:
        cursor = _execute(
            conn,
            "UPDATE account SET api_coin_balance = api_coin_balance - 1, updated_at = ? WHERE id = 1 AND api_coin_balance > 0",
            (now,),
        )
        if cursor.rowcount == 0:
            return False
    return True


def save_onboarding(completed: bool, interests: list[str]) -> dict[str, Any]:
    now = _now()
    with db() as conn:
        if using_postgres():
            _execute(
                conn,
                "INSERT INTO onboarding (id, completed, interests, created_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET completed = EXCLUDED.completed, interests = EXCLUDED.interests, updated_at = EXCLUDED.updated_at",
                (1 if completed else 0, json.dumps(interests), now, now),
            )
        else:
            _execute(conn, "UPDATE onboarding SET completed = ?, interests = ?, updated_at = ? WHERE id = 1", (1 if completed else 0, json.dumps(interests), now))
    return get_onboarding()


def get_saved_requests() -> list[dict[str, Any]]:
    with db() as conn:
        rows = _fetch_rows(_execute(conn, "SELECT * FROM saved_requests ORDER BY updated_at DESC"))
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "apiId": row["api_id"],
            "method": row["method"],
            "body": json.loads(row["body"]),
            "headers": json.loads(row["headers"]),
            "query": json.loads(row["query"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def save_saved_request(payload: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    with db() as conn:
        existing = _fetch_rows(_execute(conn, "SELECT created_at FROM saved_requests WHERE id = ?", (payload["id"],)))
        created_at = existing[0]["created_at"] if existing else now
        if using_postgres():
            _execute(conn, "DELETE FROM saved_requests WHERE id = ?", (payload["id"],))
        else:
            _execute(conn, "INSERT OR REPLACE INTO saved_requests (id, name, api_id, method, body, headers, query, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    payload["id"],
                    payload["name"],
                    payload["apiId"],
                    payload["method"],
                    json.dumps(payload.get("body", {})),
                    json.dumps(payload.get("headers", {})),
                    json.dumps(payload.get("query", {})),
                    created_at,
                    now,
                ),
            )
            return payload | {"createdAt": created_at, "updatedAt": now}
        _execute(
            conn,
            "INSERT INTO saved_requests (id, name, api_id, method, body, headers, query, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                payload["id"],
                payload["name"],
                payload["apiId"],
                payload["method"],
                json.dumps(payload.get("body", {})),
                json.dumps(payload.get("headers", {})),
                json.dumps(payload.get("query", {})),
                created_at,
                now,
            ),
        )
    return payload | {"createdAt": created_at, "updatedAt": now}
