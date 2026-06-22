export type ApiDefinition = {
  id: string;
  name: string;
  category: string;
  endpoint: string;
  method: "GET" | "POST";
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples: Array<{ request: Record<string, unknown>; response: Record<string, unknown> }>;
  tags: string[];
  complexity: "low" | "medium" | "high";
  auth: "none" | "optional" | "required";
  requiredTier: "free" | "pro" | "enterprise";
  family: string;
  mode: string;
  endpointVariants: string[];
  rateLimitPerMinute: number;
  polished: boolean;
};

export type Category = {
  id: string;
  name: string;
  description: string;
  count: number;
};

export type ExecutionResult = {
  apiId: string;
  endpoint: string;
  method: "GET" | "POST";
  statusCode: number;
  latencyMs: number;
  requestId: string;
  data: Record<string, unknown>;
  error?: { message: string; details?: unknown } | null;
};

export type Settings = {
  theme: "light" | "dark";
  response_format: "json" | "raw" | "pretty";
  local_port: number;
  auto_save_requests: boolean;
  telemetry: boolean;
  compact_mode: boolean;
  subscription_tier: "free" | "pro" | "enterprise";
};

export type Onboarding = {
  completed: boolean;
  interests: string[];
  createdAt: string;
  updatedAt: string;
};

export type Recommendation = {
  items: ApiDefinition[];
};

export type Account = {
  signedUp: boolean;
  displayName: string;
  email: string;
  apiCoinBalance: number;
  createdAt: string;
  updatedAt: string;
};

export type CheckoutReceipt = {
  id: string;
  receiptNumber: string;
  apiId: string;
  apiName: string;
  tier: "pro" | "enterprise";
  amountCents: number;
  currency: string;
  checkoutUrl: string;
  status: "pending" | "paid" | "failed";
  provider: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};
