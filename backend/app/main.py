from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta
import os
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path

_BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_BACKEND_ENV)

from .models import ApiExecuteRequest, Collection, Workflow
from .registry import REGISTRY, api_categories, build_workflow_preview, execute_api, health_stats, registry_map, search_registry, tier_allows
from .storage import (
    add_execution,
    add_recent_search,
    complete_checkout_receipt,
    count_recent_executions,
    delete_collection as delete_collection_row,
    get_account,
    get_checkout_receipts,
    get_collections as get_collection_rows,
    get_executions,
    get_favorites,
    get_onboarding,
    get_recent_searches,
    get_saved_requests,
    get_settings,
    get_workflows as get_workflow_rows,
    init_db,
    save_collection,
    save_onboarding,
    save_saved_request,
    sign_up_account,
    save_workflow,
    seed_collection_rows,
    seed_workflow_rows,
    spend_api_coin,
    toggle_favorite,
    update_settings,
    create_checkout_receipt,
)


app = FastAPI(title="Magnexis APIHub", version="1.0.0")

SQUARE_CHECKOUT_URLS = {
    "pro": os.getenv("SQUARE_CHECKOUT_URL_PRO", "").strip(),
    "enterprise": os.getenv("SQUARE_CHECKOUT_URL_ENTERPRISE", "").strip(),
}
DEFAULT_SQUARE_CHECKOUT_URL = os.getenv("SQUARE_CHECKOUT_URL", "").strip()


def _allowed_origins() -> list[str]:
    configured = [origin.strip() for origin in os.getenv("MAGNEXIS_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
    if configured:
        return configured
    return ["*"]


def _checkout_amount_cents(tier: str) -> int:
    return {"pro": 1200, "enterprise": 3900}.get(tier, 0)


def _checkout_url_for_tier(tier: str) -> str:
    url = SQUARE_CHECKOUT_URLS.get(tier) or DEFAULT_SQUARE_CHECKOUT_URL
    if not url:
        raise HTTPException(
          status_code=503,
          detail="Square checkout URL is not configured. Set SQUARE_CHECKOUT_URL_PRO or SQUARE_CHECKOUT_URL_ENTERPRISE in .env.",
      )
    return url

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def bootstrap_state() -> None:
    init_db()
    if not get_collection_rows():
        seed_collection_rows(
            [
                {
                    "id": "developer-starter-pack",
                    "name": "Developer Starter Pack",
                    "description": "Core dev utilities for daily work.",
                    "items": [REGISTRY[7].id, REGISTRY[12].id, REGISTRY[13].id, REGISTRY[14].id, REGISTRY[15].id],
                    "color": "blue",
                },
                {
                    "id": "web-builder-pack",
                    "name": "Web Builder Pack",
                    "description": "SEO and web quality APIs.",
                    "items": [REGISTRY[60].id, REGISTRY[61].id, REGISTRY[62].id, REGISTRY[64].id, REGISTRY[65].id],
                    "color": "green",
                },
                {
                    "id": "game-dev-pack",
                    "name": "Game Dev Pack",
                    "description": "Story, quest, and loot generation APIs.",
                    "items": [REGISTRY[300].id, REGISTRY[301].id, REGISTRY[302].id, REGISTRY[303].id],
                    "color": "purple",
                },
                {
                    "id": "business-pack",
                    "name": "Business Pack",
                    "description": "Planning, finance, and productivity APIs.",
                    "items": [REGISTRY[180].id, REGISTRY[181].id, REGISTRY[182].id, REGISTRY[190].id],
                    "color": "amber",
                },
            ]
        )
    if not get_workflow_rows():
        seed_workflow_rows(
            [
                {
                    "id": "text-ideas",
                    "name": "Text Ideas Pipeline",
                    "description": "Extract keywords, generate a title, and emit SEO metadata.",
                    "steps": [REGISTRY[2].id, REGISTRY[11].id, REGISTRY[60].id],
                }
            ]
        )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "Magnexis APIHub", "timestamp": datetime.utcnow().isoformat(), "stats": health_stats(get_executions(250))}


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    return health()


@app.get("/api/categories")
def categories() -> list[dict[str, Any]]:
    return api_categories()


@app.get("/api/catalog")
def catalog(
    query: str | None = Query(default=None),
    category: str | None = Query(default=None),
    method: str | None = Query(default=None),
    complexity: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    input_type: str | None = Query(default=None),
    output_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    sort: str | None = Query(default=None),
) -> dict[str, Any]:
    items = search_registry(query=query, category=category, tag=tag, input_type=input_type, output_type=output_type)
    if method:
        items = [item for item in items if item.method.lower() == method.lower()]
    if complexity:
        items = [item for item in items if item.complexity.lower() == complexity.lower()]
    if status == "recent":
        items = sorted(items, key=lambda item: (not item.polished, item.id))
    elif status == "most-tested":
        stats = get_executions(1000)
        counts = {api_id: sum(1 for row in stats if row["apiId"] == api_id) for api_id in {item.id for item in items}}
        items = sorted(items, key=lambda item: counts.get(item.id, 0), reverse=True)
    if sort == "a-z":
        items = sorted(items, key=lambda item: item.name.lower())
    elif sort == "newest":
        items = sorted(items, key=lambda item: item.id, reverse=True)
    elif sort == "fastest":
        items = sorted(items, key=lambda item: item.complexity)
    elif sort == "popular":
        executions = get_executions(250)
        counts = {api_id: sum(1 for row in executions if row["apiId"] == api_id) for api_id in {item.id for item in items}}
        items = sorted(items, key=lambda item: counts.get(item.id, 0), reverse=True)
    if query:
        add_recent_search(query)
    return {
        "items": [item.model_dump() for item in items],
        "total": len(items),
        "categories": api_categories(),
    }


@app.get("/api/catalog/{api_id}")
def api_detail(api_id: str) -> dict[str, Any]:
    item = registry_map().get(api_id)
    if not item:
        raise HTTPException(status_code=404, detail="API not found")
    return item.model_dump()


@app.post("/api/execute")
def execute(request: ApiExecuteRequest) -> dict[str, Any]:
    registry = registry_map()
    definition = registry.get(request.apiId)
    if not definition:
        raise HTTPException(status_code=404, detail="API not found")
    use_coin = bool(request.body.get("useCoin"))
    current_tier = str(get_settings().get("subscription_tier", "free"))
    tier_blocked = not tier_allows(current_tier, definition.requiredTier)
    rate_blocked = count_recent_executions(request.apiId, 60) >= definition.rateLimitPerMinute
    if tier_blocked or rate_blocked:
        if use_coin:
            if not spend_api_coin():
                raise HTTPException(
                    status_code=402 if tier_blocked else 429,
                    detail={
                        "message": "Magnexis API Coin required",
                        "requiredTier": definition.requiredTier,
                        "currentTier": current_tier,
                        "apiId": request.apiId,
                        "rateLimitPerMinute": definition.rateLimitPerMinute,
                        "retryAfterSeconds": 60 if rate_blocked else None,
                        "coinRequired": True,
                    },
                )
        else:
            raise HTTPException(
                status_code=402 if tier_blocked else 429,
                detail={
                    "message": "Magnexis API Coin required",
                    "requiredTier": definition.requiredTier,
                    "currentTier": current_tier,
                    "apiId": request.apiId,
                    "rateLimitPerMinute": definition.rateLimitPerMinute,
                    "retryAfterSeconds": 60 if rate_blocked else None,
                    "coinRequired": True,
                },
            )
    started = time.perf_counter()
    payload = request.body | {"query": request.query, "headers": request.headers}
    data = execute_api(definition, payload)
    latency_ms = max(12, int((time.perf_counter() - started) * 1000) + 18)
    status_code = 200
    execution = {
        "apiId": request.apiId,
        "statusCode": status_code,
        "latencyMs": latency_ms,
        "timestamp": datetime.utcnow().isoformat(),
    }
    add_execution(request.apiId, definition.endpoint, status_code, latency_ms, request.body | {"query": request.query, "headers": request.headers}, data)
    return {
        "apiId": request.apiId,
        "endpoint": definition.endpoint,
        "method": request.method or definition.method,
        "statusCode": status_code,
        "latencyMs": latency_ms,
        "requestId": f"mag-{uuid.uuid4().hex[:12]}",
        "data": data,
        "error": None,
    }


@app.get("/api/account")
def account() -> dict[str, Any]:
    return get_account()


@app.post("/api/account/signup")
def account_signup(payload: dict[str, Any]) -> dict[str, Any]:
    display_name = str(payload.get("displayName", "")).strip() or "Magnexis User"
    email = str(payload.get("email", "")).strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    return sign_up_account(display_name, email)


@app.get("/api/collections")
def get_collections() -> list[dict[str, Any]]:
    return get_collection_rows()


@app.post("/api/collections")
def create_collection(collection: Collection) -> dict[str, Any]:
    return save_collection(collection.model_dump())


@app.delete("/api/collections/{collection_id}")
def delete_collection(collection_id: str) -> dict[str, Any]:
    delete_collection_row(collection_id)
    return {"ok": True}


@app.get("/api/workflows")
def get_workflows() -> list[dict[str, Any]]:
    return get_workflow_rows()


@app.post("/api/workflows/preview")
def workflow_preview(stepIds: list[str] = Body(...)) -> dict[str, Any]:
    return {"steps": build_workflow_preview(stepIds)}


@app.post("/api/workflows")
def create_workflow(payload: dict[str, Any]) -> dict[str, Any]:
    return save_workflow(payload)


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    return health_stats(get_executions(500))


@app.get("/api/search")
def search(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    method: str | None = Query(default=None),
    complexity: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    input_type: str | None = Query(default=None),
    output_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    sort: str | None = Query(default=None),
) -> dict[str, Any]:
    return catalog(query=q, category=category, method=method, complexity=complexity, tag=tag, input_type=input_type, output_type=output_type, status=status, sort=sort)


@app.get("/api/recommendations")
def recommendations() -> dict[str, Any]:
    executions = get_executions(250)
    favorite_ids = set(get_favorites())
    usage = {}
    for row in executions:
        usage[row["apiId"]] = usage.get(row["apiId"], 0) + 1
    ranked = sorted(REGISTRY, key=lambda item: (item.id not in favorite_ids, -usage.get(item.id, 0), not item.polished, item.name.lower()))
    return {"items": [item.model_dump() for item in ranked[:12]]}


@app.get("/api/recent-searches")
def recent_searches() -> list[str]:
    return get_recent_searches(12)


@app.post("/api/favorites/{api_id}")
def favorite(api_id: str) -> dict[str, Any]:
    return {"apiId": api_id, "favorite": toggle_favorite(api_id)}


@app.get("/api/favorites")
def favorites() -> list[str]:
    return get_favorites()


@app.get("/api/settings")
def settings() -> dict[str, Any]:
    return get_settings()


@app.post("/api/settings")
def update_settings_route(payload: dict[str, Any]) -> dict[str, Any]:
    return update_settings(payload)


@app.get("/api/onboarding")
def onboarding() -> dict[str, Any]:
    return get_onboarding()


@app.post("/api/onboarding")
def save_onboarding_route(payload: dict[str, Any]) -> dict[str, Any]:
    return save_onboarding(bool(payload.get("completed")), list(payload.get("interests", [])))


@app.get("/api/billing/receipts")
def billing_receipts() -> list[dict[str, Any]]:
    return get_checkout_receipts()


@app.post("/api/billing/checkout/start")
def billing_checkout_start(payload: dict[str, Any]) -> dict[str, Any]:
    api_id = str(payload.get("apiId", "")).strip()
    tier = str(payload.get("tier", "free")).strip().lower()
    api = registry_map().get(api_id)
    if not api:
        raise HTTPException(status_code=404, detail="API not found")
    if tier not in {"pro", "enterprise"}:
        raise HTTPException(status_code=400, detail="A paid tier is required for checkout")
    checkout_url = _checkout_url_for_tier(tier)
    receipt = create_checkout_receipt(
        api_id=api.id,
        api_name=api.name,
        tier=tier,
        amount_cents=_checkout_amount_cents(tier),
        currency="USD",
        checkout_url=checkout_url,
        provider="square",
    )
    return {"checkoutUrl": checkout_url, "receipt": receipt}


@app.post("/api/billing/checkout/complete")
def billing_checkout_complete(payload: dict[str, Any]) -> dict[str, Any]:
    receipt_id = str(payload.get("receiptId", "")).strip()
    if not receipt_id:
        raise HTTPException(status_code=400, detail="receiptId is required")
    receipt = complete_checkout_receipt(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {"receipt": receipt, "settings": get_settings()}


@app.get("/api/saved-requests")
def saved_requests() -> list[dict[str, Any]]:
    return get_saved_requests()


@app.post("/api/saved-requests")
def save_request_route(payload: dict[str, Any]) -> dict[str, Any]:
    return save_saved_request(payload)


@app.get("/api/health/overview")
def health_overview() -> dict[str, Any]:
    stats_data = health_stats(get_executions(500))
    return {
        "stats": stats_data,
        "recentSearches": get_recent_searches(5),
        "favorites": get_favorites()[:8],
        "settings": get_settings(),
    }
