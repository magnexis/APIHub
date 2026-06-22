import type { Account, ApiDefinition, CheckoutReceipt, Category, ExecutionResult, Onboarding, Recommendation, Settings } from "../types";

const DEFAULT_API_BASE_URL = "";
const API_BASE_URL =
  (import.meta.env.VITE_MAGNEXIS_API_URL as string | undefined)?.replace(/\/+$/, "") ||
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ||
  DEFAULT_API_BASE_URL;

export function getApiBaseUrl(): string {
  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return API_BASE_URL;
  }
  const { hostname, protocol } = window.location;
  if (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return window.location.origin;
  }
  return "";
}

type QueryValue = string | number | boolean | null | undefined;

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing VITE_MAGNEXIS_API_URL. Set it to the Railway backend URL for production deployments.");
  }
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : typeof payload === "object" && payload && "detail" in payload
          ? typeof (payload as { detail: unknown }).detail === "string"
            ? (payload as { detail: string }).detail
            : JSON.stringify((payload as { detail: unknown }).detail)
          : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

async function request<T>(path: string, init?: RequestInit, query?: Record<string, QueryValue>): Promise<T> {
  const response = await fetch(buildUrl(path, query), {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  return parseResponse<T>(response);
}

async function get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
  return request<T>(path, { method: "GET" }, query);
}

async function post<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  }, query);
}

async function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export async function loadCatalog(query = ""): Promise<{ items: ApiDefinition[]; total: number; categories: Category[] }> {
  return get("/api/catalog", { query });
}

export async function loadCategories(): Promise<Category[]> {
  return get("/api/categories");
}

export async function loadHealth(): Promise<Record<string, unknown>> {
  return get("/api/health");
}

export async function loadHealthOverview(): Promise<Record<string, unknown>> {
  return get("/api/health/overview");
}

export async function loadStats(): Promise<Record<string, unknown>> {
  return get("/api/stats");
}

export async function loadCollections(): Promise<Array<{ id: string; name: string; description?: string; items: { apiId: string; note?: string }[] }>> {
  return get("/api/collections");
}

export async function saveCollection(payload: unknown): Promise<unknown> {
  return post("/api/collections", payload);
}

export async function deleteCollection(id: string): Promise<unknown> {
  return del(`/api/collections/${encodeURIComponent(id)}`);
}

export async function loadWorkflows(): Promise<Array<{ id: string; name: string; description?: string; steps: { apiId: string }[] }>> {
  return get("/api/workflows");
}

export async function saveWorkflow(payload: unknown): Promise<unknown> {
  return post("/api/workflows", payload);
}

export async function previewWorkflow(stepIds: string[]): Promise<{ steps: Array<{ apiId: string; endpoint: string; output: Record<string, unknown> }> }> {
  return post("/api/workflows/preview", stepIds);
}

export async function executeApi(apiId: string, body: Record<string, unknown>, headers: Record<string, string>, query: Record<string, unknown>, useCoin = false): Promise<ExecutionResult> {
  return post("/api/execute", {
    apiId,
    body: { ...body, useCoin },
    headers,
    query,
  });
}

export async function loadRecommendations(): Promise<Recommendation> {
  return get("/api/recommendations");
}

export async function loadRecentSearches(): Promise<string[]> {
  return get("/api/recent-searches");
}

export async function toggleFavorite(apiId: string): Promise<{ apiId: string; favorite: boolean }> {
  return post(`/api/favorites/${encodeURIComponent(apiId)}`);
}

export async function loadFavorites(): Promise<string[]> {
  return get("/api/favorites");
}

export async function loadSettings(): Promise<Settings> {
  return get("/api/settings");
}

export async function updateSettings(payload: Partial<Settings>): Promise<Settings> {
  return post("/api/settings", payload);
}

export async function loadOnboarding(): Promise<Onboarding> {
  return get("/api/onboarding");
}

export async function saveOnboarding(payload: { completed: boolean; interests: string[] }): Promise<Onboarding> {
  return post("/api/onboarding", payload);
}

export async function loadSavedRequests(): Promise<Array<{ id: string; name: string; apiId: string; method: string; body: Record<string, unknown>; headers: Record<string, unknown>; query: Record<string, unknown> }>> {
  return get("/api/saved-requests");
}

export async function saveRequest(payload: unknown): Promise<unknown> {
  return post("/api/saved-requests", payload);
}

export async function loadAccount(): Promise<Account> {
  return get("/api/account");
}

export async function signUpAccount(payload: { displayName: string; email: string }): Promise<Account> {
  return post("/api/account/signup", payload);
}

export async function startCheckout(payload: { apiId: string; tier: "pro" | "enterprise" }): Promise<{ checkoutUrl: string; receipt: CheckoutReceipt }> {
  return post("/api/billing/checkout/start", payload);
}

export async function completeCheckout(payload: { receiptId: string }): Promise<{ receipt: CheckoutReceipt; settings: Settings }> {
  return post("/api/billing/checkout/complete", payload);
}

export async function loadCheckoutReceipts(): Promise<CheckoutReceipt[]> {
  return get("/api/billing/receipts");
}
