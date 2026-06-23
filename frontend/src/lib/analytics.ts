export type AnalyticsEventName =
  | "checkout_page_view"
  | "checkout_button_click"
  | "payment_success"
  | "payment_cancelled"
  | "payment_processing_view";

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  timestamp: string;
  payload?: Record<string, unknown>;
};

const ANALYTICS_STORAGE_KEY = "magnexis-analytics-events";

export function trackEvent(name: AnalyticsEventName, payload: Record<string, unknown> = {}): void {
  const event: AnalyticsEvent = {
    name,
    timestamp: new Date().toISOString(),
    payload,
  };
  try {
    const existing = readEvents();
    existing.unshift(event);
    window.localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(existing.slice(0, 100)));
    window.dispatchEvent(new CustomEvent("magnexis:analytics", { detail: event }));
  } catch {
    // Keep analytics best-effort only.
  }
}

export function readEvents(): AnalyticsEvent[] {
  try {
    const raw = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

