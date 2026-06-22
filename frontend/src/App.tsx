import { Component, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  executeApi,
  completeCheckout,
  loadCheckoutReceipts,
  loadAccount,
  loadCatalog,
  loadCategories,
  loadCollections,
  loadFavorites,
  loadHealthOverview,
  loadHealth,
  loadOnboarding,
  loadRecentSearches,
  loadRecommendations,
  loadSavedRequests,
  loadSettings,
  loadStats,
  loadWorkflows,
  getApiBaseUrl,
  saveCollection,
  saveOnboarding,
  saveWorkflow,
  saveRequest,
  signUpAccount,
  startCheckout,
  toggleFavorite,
  updateSettings,
} from "./lib/api";
import type { Account, ApiDefinition, CheckoutReceipt, Category, ExecutionResult, Onboarding, Recommendation, Settings } from "./types";

type AppView = "dashboard" | "catalog" | "playground" | "collections" | "workflows" | "settings";
type ApiTab = "overview" | "request" | "response" | "examples" | "errors" | "code" | "history";
type SortMode = "popular" | "a-z" | "newest" | "fastest" | "recent";
type AppRoute = {
  view: AppView;
  apiId?: string;
  tab?: ApiTab;
  collectionId?: string;
  workflowId?: string;
  search?: string;
  requestId?: string;
};

type WorkflowStep = {
  apiId: string;
  inputMap: string;
  outputMap: string;
  status: "idle" | "ready" | "tested";
  result: string;
};

type SearchResult = {
  apis: ApiDefinition[];
  categories: Category[];
  collections: { id: string; name: string; description?: string }[];
  workflows: { id: string; name: string; description?: string }[];
};

type SavedResult = {
  id: string;
  name: string;
  endpoint: string;
  statusCode: number;
  savedAt: string;
  payload: Record<string, unknown>;
};

const ALL_INTERESTS = ["Developer Tools", "AI Utilities", "Business", "Game Dev", "Security", "Web Tools", "Data Tools"];

const QUICK_ACTIONS = [
  { title: "Test an API", view: "catalog" as const, description: "Open the catalog and try a custom Magnexis endpoint." },
  { title: "Browse Categories", view: "catalog" as const, description: "Explore the registry by product category." },
  { title: "Create Collection", view: "collections" as const, description: "Save your favorite APIs into a reusable pack." },
  { title: "Build Workflow", view: "workflows" as const, description: "Chain APIs into a clean ordered pipeline." },
  { title: "View Recent Tests", view: "dashboard" as const, description: "Review local execution history and latency." },
  { title: "Generate Code", view: "catalog" as const, description: "Copy ready-to-run request snippets." },
];

const API_PACKS = [
  {
    name: "Developer Starter Pack",
    description: "JSON Formatter, UUID Generator, Regex Tester, Hash Generator, Env Validator.",
    apiIds: ["dev.json-formatter.standard", "dev.uuid-generator.standard", "dev.regex-tester.standard", "dev.hash-generator.standard", "dev.env-validator.standard"],
    color: "blue",
  },
  {
    name: "Web Builder Pack",
    description: "Meta Tag Generator, Robots Generator, Sitemap Builder, SEO Score, Color Palette.",
    apiIds: ["web.meta-tag-generator.standard", "web.robots-generator.standard", "web.sitemap-builder.standard", "web.seo-score.standard", "web.color-palette.standard"],
    color: "green",
  },
  {
    name: "Game Dev Pack",
    description: "NPC Name Generator, Quest Generator, Loot Table, Dialogue Tree.",
    apiIds: ["game.npc-name-generator.standard", "game.quest-generator.standard", "game.loot-table.standard", "game.dialogue-tree.standard"],
    color: "violet",
  },
  {
    name: "Business Pack",
    description: "Invoice Generator, Profit Estimator, Budget Breakdown, Task Prioritizer.",
    apiIds: ["business.invoice-generator.standard", "business.profit-estimator.standard", "business.budget-breakdown.standard", "business.task-prioritizer.standard"],
    color: "amber",
  },
];

const DEFAULT_BODY = JSON.stringify({ text: "Magnexis APIHub unlocks custom API workflows." }, null, 2);
const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  response_format: "json",
  local_port: 8787,
  auto_save_requests: true,
  telemetry: false,
  compact_mode: false,
  subscription_tier: "free",
};
const TIER_ORDER = { free: 0, pro: 1, enterprise: 2 } as const;
const SUBSCRIPTION_PLANS = [
  {
    tier: "free" as const,
    label: "Free",
    price: "$0",
    description: "Core local APIs and starter tools.",
    highlights: ["Core catalog access", "Collections", "Workflows", "Local execution"],
  },
  {
    tier: "pro" as const,
    label: "Pro",
    price: "$12/mo",
    description: "Unlock advanced Magnexis APIs and richer workflows.",
    highlights: ["Premium APIs", "Checkout unlocks", "Workflow chaining", "Priority support"],
  },
  {
    tier: "enterprise" as const,
    label: "Enterprise",
    price: "$39/mo",
    description: "Unlock the full registry and advanced simulations.",
    highlights: ["Enterprise APIs", "Bulk unlocks", "Local billing records", "Team-ready"],
  },
] as const;

function AppShell() {
  const initialRoute = parseRoute(window.location.hash);
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [view, setView] = useState<AppView>(initialRoute.view);
  const [catalog, setCatalog] = useState<ApiDefinition[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string; description?: string; color?: string; items: { apiId: string; note?: string }[]; updatedAt?: string }>>([]);
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; description?: string; steps: Array<string | { apiId: string; inputMap?: string; outputMap?: string }> }>>([]);
  const [selectedApi, setSelectedApi] = useState<ApiDefinition | null>(null);
  const [activeApiTab, setActiveApiTab] = useState<ApiTab>(initialRoute.tab ?? "overview");
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [complexityFilter, setComplexityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [recommendations, setRecommendations] = useState<Recommendation>({ items: [] });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savedRequests, setSavedRequests] = useState<Array<{ id: string; name: string; apiId: string; method: string }>>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadStoredSettings());
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loadingApi, setLoadingApi] = useState(false);
  const [requestBody, setRequestBody] = useState(DEFAULT_BODY);
  const [requestHeaders, setRequestHeaders] = useState(JSON.stringify({ "x-magnexis-client": "web" }, null, 2));
  const [requestParams, setRequestParams] = useState(JSON.stringify({ mode: "standard" }, null, 2));
  const [requestMethod, setRequestMethod] = useState<"GET" | "POST">("POST");
  const [environment, setEnvironment] = useState("Local");
  const [response, setResponse] = useState<ExecutionResult | null>(null);
  const [requestHistory, setRequestHistory] = useState<ExecutionResult[]>([]);
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowStep[]>([]);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<Settings>(settings);
  const [collectionTheme, setCollectionTheme] = useState("blue");
  const [checkoutApi, setCheckoutApi] = useState<ApiDefinition | null>(null);
  const [checkoutTier, setCheckoutTier] = useState<Settings["subscription_tier"]>("pro");
  const [checkoutSession, setCheckoutSession] = useState<{ receipt: CheckoutReceipt; checkoutUrl: string } | null>(null);
  const [checkoutReceipts, setCheckoutReceipts] = useState<CheckoutReceipt[]>([]);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [coinApi, setCoinApi] = useState<ApiDefinition | null>(null);
  const [coinReason, setCoinReason] = useState<"tier" | "rate">("tier");
  const [signupDraft, setSignupDraft] = useState({ displayName: "", email: "" });
  const [showSignup, setShowSignup] = useState(false);
  const [savedResults, setSavedResults] = useState<SavedResult[]>(() => loadStoredResults());
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const collectionsImportRef = useRef<HTMLInputElement | null>(null);
  const workflowsImportRef = useRef<HTMLInputElement | null>(null);
  const selectedWorkflow = useMemo(() => workflows.find((workflow) => workflow.id === route.workflowId) ?? workflows[0] ?? null, [route.workflowId, workflows]);
  const [catalogLimit, setCatalogLimit] = useState(120);
  const deferredQuery = useDeferredValue(query);
  const deferredCatalogQuery = useDeferredValue(catalogQuery);

  useEffect(() => {
    void loadAll().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to load app data.";
      setStartupError(message);
      setCatalog([]);
      setCategories([]);
      setCollections([]);
      setWorkflows([]);
      setHealth({});
      setStats({});
      setRecommendations({ items: [] });
      setRecentSearches([]);
      setFavorites([]);
      setSavedRequests([]);
      setOnboarding({ completed: false, interests: [] });
      setAccount({ signedUp: false, apiCoinBalance: 0, apiCoinsClaimed: 0 });
      setCheckoutReceipts([]);
      setShowSignup(false);
    });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (onboarding && !onboarding.completed) {
      setShowOnboarding(true);
    }
  }, [onboarding]);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [view, route.apiId, route.collectionId, route.workflowId]);

  useEffect(() => {
    if (route.search !== undefined && route.search !== catalogQuery) {
      setCatalogQuery(route.search);
    }
  }, [catalogQuery, route.search]);

  useEffect(() => {
    if (route.view !== view) {
      setView(route.view);
    }
    if ((route.view === "catalog" || route.view === "playground") && route.apiId) {
      const match = catalog.find((api) => api.id === route.apiId);
      if (match && selectedApi?.id !== match.id) {
        setSelectedApi(match);
      }
      if (route.view === "catalog" && route.tab && activeApiTab !== route.tab) {
        setActiveApiTab(route.tab);
      }
      if (route.requestId) {
        const savedRequest = savedRequests.find((item) => item.id === route.requestId);
        if (savedRequest) {
          const savedApi = catalog.find((item) => item.id === savedRequest.apiId);
          if (savedApi && selectedApi?.id !== savedApi.id) {
            setSelectedApi(savedApi);
          }
          if (activeApiTab !== "history") {
            setActiveApiTab("history");
          }
          setRequestMethod(savedRequest.method as "GET" | "POST");
          setRequestBody(JSON.stringify(savedRequest.body ?? {}, null, 2));
          setRequestHeaders(JSON.stringify(savedRequest.headers ?? {}, null, 2));
          setRequestParams(JSON.stringify(savedRequest.query ?? {}, null, 2));
        }
      }
    } else if (route.view === "catalog" || route.view === "playground") {
      if (selectedApi) {
        setSelectedApi(null);
      }
      if (activeApiTab !== "overview") {
        setActiveApiTab("overview");
      }
    }
    if (route.view === "workflows") {
      const sourceWorkflow = selectedWorkflow ?? workflows[0] ?? null;
      setWorkflowDraft(buildWorkflowDraft(sourceWorkflow));
      setWorkflowName(sourceWorkflow?.name ?? "");
      setWorkflowDescription(sourceWorkflow?.description ?? "");
    }
  }, [activeApiTab, catalog, route, savedRequests, selectedApi, selectedWorkflow, view, workflows]);

  useEffect(() => {
    if ((route.view === "catalog" || route.view === "playground") && route.apiId) {
      const match = catalog.find((api) => api.id === route.apiId);
      if (match && selectedApi?.id !== match.id) {
        setSelectedApi(match);
      }
    }
    if (route.view === "catalog" && route.tab && activeApiTab !== route.tab) {
      setActiveApiTab(route.tab);
    }
  }, [activeApiTab, catalog, route.apiId, route.tab, route.view, selectedApi]);

  useEffect(() => {
    persistLocal("magnexis-settings", settings);
  }, [settings]);

  useEffect(() => {
    persistLocal("magnexis-saved-results", savedResults);
  }, [savedResults]);

  useEffect(() => {
    setCatalogLimit(120);
  }, [deferredQuery, deferredCatalogQuery, categoryFilter, methodFilter, complexityFilter, statusFilter, sort]);

  const catalogIndex = useMemo(
    () =>
      catalog.map((api) => ({
        api,
        searchableText: [api.name, api.endpoint, api.category, api.description, ...api.tags].join(" ").toLowerCase(),
      })),
    [catalog],
  );

  const filteredCatalog = useMemo(() => {
    return catalogIndex.filter(({ api, searchableText }) => {
      const matchesQuery = !deferredCatalogQuery || searchableText.includes(deferredCatalogQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || api.category === categoryFilter;
      const matchesMethod = methodFilter === "all" || api.method === methodFilter;
      const matchesComplexity = complexityFilter === "all" || api.complexity === complexityFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "recent" && api.polished) ||
        (statusFilter === "featured" && api.polished) ||
        (statusFilter === "saved" && favorites.includes(api.id));
      const matchesGlobalSearch = !deferredQuery || searchableText.includes(deferredQuery.toLowerCase());
      return matchesQuery && matchesCategory && matchesMethod && matchesComplexity && matchesStatus && matchesGlobalSearch;
    }).map(({ api }) => api);
  }, [catalogIndex, categoryFilter, complexityFilter, deferredCatalogQuery, deferredQuery, favorites, methodFilter, statusFilter]);

  const visibleCatalog = useMemo(() => filteredCatalog.slice(0, catalogLimit), [catalogLimit, filteredCatalog]);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === route.collectionId) ?? collections.find((collection) => collection.id === "developer-starter-pack") ?? collections[0] ?? null,
    [collections, route.collectionId],
  );
  const selectedSavedRequest = useMemo(() => savedRequests.find((request) => request.id === route.requestId) ?? null, [route.requestId, savedRequests]);
  const statsRow = deriveStats(stats, account, favorites, collections, workflows, requestHistory);
  const currentSnippet = useMemo(() => buildSnippet(selectedApi, requestBody), [selectedApi, requestBody]);
  const searchResults = useMemo(() => buildSearchResults(deferredQuery, catalog, collections, workflows, categories), [deferredQuery, catalog, collections, workflows, categories]);
  const navigate = (nextRoute: AppRoute) => {
    const nextHash = buildHash(nextRoute);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    setSearchOpen(false);
  };

  async function loadAll() {
    await waitForBackendReady();
    const [
      catalogResponse,
      categoriesResponse,
      collectionsResponse,
      workflowsResponse,
      healthResponse,
      statsResponse,
      recommendationsResponse,
      recentSearchesResponse,
      favoritesResponse,
      savedRequestsResponse,
      settingsResponse,
      onboardingResponse,
      accountResponse,
      receiptsResponse,
    ] = await Promise.all([
      loadCatalog(),
      loadCategories(),
      loadCollections(),
      loadWorkflows(),
      loadHealthOverview(),
      loadStats(),
      loadRecommendations(),
      loadRecentSearches(),
      loadFavorites(),
      loadSavedRequests(),
      loadSettings(),
      loadOnboarding(),
      loadAccount(),
      loadCheckoutReceipts(),
    ]);

    const catalogItems = Array.isArray(catalogResponse?.items) ? catalogResponse.items : [];
    const categoryItems = Array.isArray(categoriesResponse) ? categoriesResponse : [];
    const collectionItems = Array.isArray(collectionsResponse) ? collectionsResponse : [];
    const workflowItems = Array.isArray(workflowsResponse) ? workflowsResponse : [];
    const recommendationItems = Array.isArray(recommendationsResponse?.items) ? recommendationsResponse.items : [];
    const searchItems = Array.isArray(recentSearchesResponse) ? recentSearchesResponse : [];
    const favoriteItems = Array.isArray(favoritesResponse) ? favoritesResponse : [];
    const savedRequestItems = Array.isArray(savedRequestsResponse) ? savedRequestsResponse : [];
    const receiptItems = Array.isArray(receiptsResponse) ? receiptsResponse : [];

    setStartupError(null);
    setCatalog(catalogItems);
    setCategories(categoryItems);
    setCollections(collectionItems);
    setWorkflows(workflowItems);
    setHealth(healthResponse);
    setStats(statsResponse);
    setRecommendations({ items: recommendationItems });
    setRecentSearches(searchItems);
    setFavorites(favoriteItems);
    setSavedRequests(savedRequestItems);
    setSettings(settingsResponse);
    setSettingsDraft(settingsResponse);
    setOnboarding(onboardingResponse);
    setAccount(accountResponse);
    setCheckoutReceipts(receiptItems);
    setShowSignup(!accountResponse.signedUp);
    setSelectedApi((current) => {
      if ((route.view === "catalog" || route.view === "playground") && route.apiId) {
        return catalogItems.find((item) => item.id === route.apiId) ?? current ?? catalogItems[0] ?? null;
      }
      return current ?? catalogItems[0] ?? null;
    });
    if (route.view === "catalog" && route.tab) {
      setActiveApiTab(route.tab);
    }
    if (route.view === "workflows") {
      const sourceWorkflow = workflowItems.find((workflow) => workflow.id === route.workflowId) ?? workflowItems[0] ?? null;
      setWorkflowDraft(buildWorkflowDraft(sourceWorkflow));
      setWorkflowName(sourceWorkflow?.name ?? "");
      setWorkflowDescription(sourceWorkflow?.description ?? "");
    } else {
      setWorkflowDraft(buildWorkflowDraft(workflowItems[0] ?? null));
      setWorkflowName(workflowItems[0]?.name ?? "");
      setWorkflowDescription(workflowItems[0]?.description ?? "");
    }
  }

  async function refreshCatalog() {
    const response = await loadCatalog(catalogQuery);
    setCatalog(response.items);
  }

  async function runSelectedApi(api: ApiDefinition | null = selectedApi, useCoin = false) {
    if (!api) {
      return;
    }
    if (!canAccessApi(api, settings.subscription_tier)) {
      if (!useCoin && (account?.apiCoinBalance ?? 0) > 0) {
        promptCoin(api, "tier");
        return;
      }
      if (!useCoin) {
        promptCheckout(api);
        return;
      }
    }
    setLoadingApi(true);
    try {
      const execution = await executeApi(api.id, safeJson(requestBody), safeJson(requestHeaders), safeJson(requestParams), useCoin);
      if ((execution.statusCode === 402 || execution.statusCode === 429 || execution.error) && !useCoin) {
        const details = execution.error?.details as { requiredTier?: Settings["subscription_tier"]; coinRequired?: boolean } | undefined;
        if (details?.coinRequired && (account?.apiCoinBalance ?? 0) > 0) {
          promptCoin(api, execution.statusCode === 429 ? "rate" : "tier");
        } else if (execution.statusCode === 402) {
          const requiredTier = details?.requiredTier ?? api.requiredTier;
          promptCheckout(api, requiredTier);
        }
        setResponse(execution);
        return;
      }
      setResponse(execution);
      setRequestHistory((current) => [execution, ...current].slice(0, 12));
      setAccount(await loadAccount());
      navigate({ view: "catalog", apiId: api.id, tab: activeApiTab });
    } finally {
      setLoadingApi(false);
    }
  }

  async function saveSelectedApiToCollection() {
    if (!selectedApi || !collectionName.trim()) {
      return;
    }
    await saveCollection({
      id: slugify(collectionName),
      name: collectionName.trim(),
      description: collectionDescription.trim(),
      color: collectionTheme,
      items: [{ apiId: selectedApi.id }],
    });
    setCollectionName("");
    setCollectionDescription("");
    await loadCollections().then(setCollections);
  }

  async function addFavorite(api: ApiDefinition) {
    const result = await toggleFavorite(api.id);
    setFavorites((current) => (result.favorite ? [...current, api.id] : current.filter((id) => id !== api.id)));
  }

  async function saveCurrentRequest() {
    if (!selectedApi) {
      return;
    }
    await saveRequest({
      id: `${selectedApi.id}-${Date.now()}`,
      name: `${selectedApi.name} request`,
      apiId: selectedApi.id,
      method: requestMethod,
      body: safeJson(requestBody),
      headers: safeJson(requestHeaders),
      query: safeJson(requestParams),
    });
    setSavedRequests(await loadSavedRequests());
  }

  async function copyCurrentResponse() {
    if (!response) {
      return;
    }
    await copyToClipboard(JSON.stringify(response, null, 2));
  }

  function saveCurrentResponse() {
    if (!selectedApi || !response) {
      return;
    }
    setSavedResults((current) => [
      {
        id: `${selectedApi.id}-${Date.now()}`,
        name: `${selectedApi.name} response`,
        endpoint: selectedApi.endpoint,
        statusCode: response.statusCode,
        savedAt: new Date().toISOString(),
        payload: response.data,
      },
      ...current,
    ].slice(0, 12));
  }

  async function saveSettingsChanges() {
    const updated = await updateSettings(settingsDraft);
    setSettings(updated);
  }

  function promptCheckout(api: ApiDefinition, tier: Settings["subscription_tier"] = api.requiredTier) {
    setCheckoutApi(api);
    setCheckoutTier(maxTier(tier, api.requiredTier));
    setCheckoutSession(null);
    setCheckoutError(null);
  }

  function promptCoin(api: ApiDefinition, reason: "tier" | "rate") {
    setCoinApi(api);
    setCoinReason(reason);
  }

  async function completeCoinSpend() {
    const api = coinApi;
    if (!api) {
      return;
    }
    const updatedAccount = await loadAccount();
    setAccount(updatedAccount);
    setCoinApi(null);
    await runSelectedApi(api, true);
  }

  async function beginCheckout() {
    const api = checkoutApi;
    if (!api) {
      return;
    }
    setCheckoutError(null);
    try {
      const session = await startCheckout({ apiId: api.id, tier: checkoutTier as "pro" | "enterprise" });
      setCheckoutSession(session);
      setCheckoutReceipts((current) => [session.receipt, ...current.filter((item) => item.id !== session.receipt.id)]);
      openExternalUrl(session.checkoutUrl);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Unable to start Square checkout");
    }
  }

  async function finalizeCheckout() {
    if (!checkoutSession) {
      return;
    }
    setCheckoutError(null);
    try {
      const updated = await completeCheckout({ receiptId: checkoutSession.receipt.id });
      setSettings(updated.settings);
      setSettingsDraft(updated.settings);
      setCheckoutReceipts((current) => current.map((receipt) => (receipt.id === updated.receipt.id ? updated.receipt : receipt)));
      const api = checkoutApi;
      setCheckoutSession(null);
      setCheckoutApi(null);
      if (api) {
        setSelectedApi(api);
        setActiveApiTab("overview");
        navigate({ view: "playground", apiId: api.id });
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Unable to complete checkout");
    }
  }

  async function saveOnboardingState() {
    const updated = await saveOnboarding({ completed: true, interests: selectedInterests });
    setOnboarding(updated);
    setShowOnboarding(false);
  }

  async function completeSignup() {
    const displayName = signupDraft.displayName.trim();
    const email = signupDraft.email.trim();
    if (!email) {
      return;
    }
    const updated = await signUpAccount({
      displayName: displayName || "Magnexis User",
      email,
    });
    setAccount(updated);
    setShowSignup(false);
    setShowOnboarding(true);
    await loadAll();
  }

  async function runWorkflowStep(index: number) {
    const step = workflowDraft[index];
    const api = catalog.find((item) => item.id === step.apiId);
    if (!api) {
      return;
    }
    const execution = await executeApi(api.id, safeJson(requestBody), safeJson(requestHeaders), safeJson(requestParams));
    setWorkflowDraft((current) =>
      current.map((item, stepIndex) => (stepIndex === index ? { ...item, status: "tested", result: JSON.stringify(execution.data).slice(0, 120) } : item)),
    );
  }

  async function runFullWorkflow() {
    for (let i = 0; i < workflowDraft.length; i += 1) {
      await runWorkflowStep(i);
    }
  }

  async function duplicateCollection(collectionId: string) {
    const source = collections.find((collection) => collection.id === collectionId);
    if (!source) {
      return;
    }
    await saveCollection({
      ...source,
      id: `${source.id}-copy`,
      name: `${source.name} Copy`,
    });
    await loadCollections().then(setCollections);
  }

  async function duplicateWorkflow(workflowId: string) {
    const source = workflows.find((workflow) => workflow.id === workflowId);
    if (!source) {
      return;
    }
    const payload = {
      id: `${source.id}-copy`,
      name: `${source.name} Copy`,
      description: source.description,
      steps: source.steps,
    };
    await saveWorkflow(payload);
    await loadWorkflows().then(setWorkflows);
  }

  async function saveCurrentWorkflow() {
    const name = workflowName.trim() || selectedWorkflow?.name || "Untitled Workflow";
    const description = workflowDescription.trim();
    const workflowId = selectedWorkflow?.id ?? slugify(name);
    const payload = {
      id: workflowId,
      name,
      description,
      steps: workflowDraft.map((step) => ({
        apiId: step.apiId,
        inputMap: step.inputMap,
        outputMap: step.outputMap,
      })),
    };
    const saved = (await saveWorkflow(payload)) as { id?: string; name?: string; description?: string; steps?: Array<string | { apiId: string; inputMap?: string; outputMap?: string }> } | undefined;
    const refreshed = await loadWorkflows();
    setWorkflows(refreshed);
    const selected = refreshed.find((workflow) => workflow.id === (saved?.id ?? workflowId)) ?? refreshed[0] ?? null;
    if (selected) {
      setWorkflowDraft(buildWorkflowDraft(selected));
      setWorkflowName(selected.name);
      setWorkflowDescription(selected.description ?? "");
      navigate({ view: "workflows", workflowId: selected.id });
    }
  }

  async function exportCollection(collectionId: string) {
    const source = collections.find((collection) => collection.id === collectionId);
    if (!source) {
      return;
    }
    downloadJson(`${source.id}.json`, source);
  }

  async function exportWorkflow(workflowId: string) {
    const source = workflows.find((workflow) => workflow.id === workflowId);
    if (!source) {
      return;
    }
    downloadJson(`${source.id}.json`, source);
  }

  async function importCollectionFile(file: File) {
    const payload = await readJsonFile(file);
    if (!payload?.id || !payload?.name) {
      return;
    }
    await saveCollection({
      id: String(payload.id),
      name: String(payload.name),
      description: payload.description ? String(payload.description) : undefined,
      color: payload.color ? String(payload.color) : "blue",
      items: Array.isArray(payload.items) ? payload.items : [],
    });
    await loadCollections().then(setCollections);
  }

  async function importWorkflowFile(file: File) {
    const payload = await readJsonFile(file);
    if (!payload?.id || !payload?.name) {
      return;
    }
    await saveWorkflow({
      id: String(payload.id),
      name: String(payload.name),
      description: payload.description ? String(payload.description) : undefined,
      steps: Array.isArray(payload.steps) ? payload.steps : [],
    });
    await loadWorkflows().then(setWorkflows);
  }

  if (showSignup) {
    return (
      <SignupScreen
        draft={signupDraft}
        onChange={setSignupDraft}
        onContinue={() => void completeSignup()}
      />
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingScreen
        selected={selectedInterests}
        onToggle={(interest) =>
          setSelectedInterests((current) =>
            current.includes(interest) ? current.filter((value) => value !== interest) : [...current, interest].slice(0, 3),
          )
        }
        onContinue={() => void saveOnboardingState()}
      />
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-[var(--app-text)]" data-theme={settings.theme}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px]">
        <aside className="hidden w-80 flex-col border-r border-slate-200/60 bg-white/90 backdrop-blur lg:flex">
          <div className="flex items-center gap-3 border-b border-slate-200/60 px-6 py-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-400 text-white shadow-[0_8px_16px_rgba(66,133,244,0.08)]">M</div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-slate-900">Magnexis APIHub</div>
              <div className="text-xs text-slate-500">Google-style API console</div>
            </div>
          </div>
          <nav className="flex-1 space-y-2 px-3 py-4">
            {NAV_ITEMS.map((item) => (
              <NavButton key={item.id} active={view === item.id} label={item.label} description={item.description} onClick={() => navigate({ view: item.id })} />
            ))}
          </nav>
          <div className="border-t border-slate-200/60 p-4">
            <div className="rounded-[22px] border border-blue-100/70 bg-blue-50/70 p-4 shadow-[0_4px_10px_rgba(15,23,42,0.04)]">
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-blue-500">Local mode</div>
              <div className="mt-2 text-sm text-slate-700">Port {settings.local_port}. Requests stay on your machine.</div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-[var(--app-bg-elevated)] px-4 py-3 backdrop-blur md:px-6">
            <div className="flex items-center gap-3 xl:hidden">
              <button
                type="button"
                onClick={() => setMobileNavOpen((current) => !current)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/70 bg-white text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                aria-label="Open navigation menu"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-[2]">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-slate-900">Magnexis APIHub</div>
                <div className="text-xs text-slate-500">Google-style API console</div>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 xl:mt-0 xl:flex-row xl:items-center">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex w-full min-w-0 flex-1 items-center gap-3 rounded-full border border-slate-200/70 bg-slate-50 px-4 py-3 text-left text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-blue-100 hover:bg-white hover:shadow-[0_6px_16px_rgba(15,23,42,0.06)]"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-400 text-white shadow-[0_2px_6px_rgba(66,133,244,0.08)]">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[2]">
                    <circle cx="11" cy="11" r="6" />
                    <path d="M16 16l4 4" />
                  </svg>
                </span>
                <span className="flex-1 text-sm">Search APIs, categories, workflows, or tools</span>
                <kbd className="hidden rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 sm:inline">Ctrl K</kbd>
              </button>
              <div className="flex items-center gap-3 xl:shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const nextTheme = settings.theme === "light" ? "dark" : "light";
                    const nextSettings = { ...settings, theme: nextTheme };
                    setSettings(nextSettings);
                    setSettingsDraft(nextSettings);
                    void updateSettings(nextSettings);
                  }}
                  className="rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-blue-100"
                >
                  {settings.theme === "light" ? "Dark" : "Light"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadAll()}
                  className="rounded-full bg-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_8px_18px_rgba(66,133,244,0.08)] hover:bg-blue-300"
                >
                  Refresh
                </button>
              </div>
            </div>
          </header>

          {mobileNavOpen && (
            <div className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-sm xl:hidden" onClick={() => setMobileNavOpen(false)}>
              <div
                className="absolute left-0 top-0 h-full w-[86vw] max-w-sm border-r border-slate-200/60 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.14)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold tracking-tight text-slate-900">Magnexis APIHub</div>
                    <div className="text-xs text-slate-500">Mobile navigation</div>
                  </div>
                  <button type="button" onClick={() => setMobileNavOpen(false)} className="rounded-full border border-slate-200/70 px-3 py-2 text-sm text-slate-600">
                    Close
                  </button>
                </div>
                <nav className="space-y-2">
                  {NAV_ITEMS.map((item) => (
                    <NavButton
                      key={item.id}
                      active={view === item.id}
                      label={item.label}
                      description={item.description}
                      onClick={() => {
                        navigate({ view: item.id });
                        setMobileNavOpen(false);
                      }}
                    />
                  ))}
                </nav>
                <div className="mt-4 rounded-[22px] border border-blue-100/70 bg-blue-50/70 p-4 shadow-[0_4px_10px_rgba(15,23,42,0.04)]">
                  <div className="text-xs font-medium uppercase tracking-[0.24em] text-blue-500">Local mode</div>
                  <div className="mt-2 text-sm text-slate-700">Port {settings.local_port}. Requests stay on your machine.</div>
                </div>
              </div>
            </div>
          )}

          <main className={`grid min-h-0 flex-1 gap-0 ${view === "playground" ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,1fr)_540px]"}`}>
            <section className="min-h-0 overflow-auto px-4 py-5 md:px-6">
              {view === "dashboard" && (
                <Dashboard
                  query={query}
                  setQuery={setQuery}
                  statsRow={statsRow}
                  recommendations={recommendations.items}
                  categories={categories}
                  onOpenCatalog={() => navigate({ view: "catalog" })}
                  onOpenCollections={() => navigate({ view: "collections" })}
                  onOpenWorkflows={() => navigate({ view: "workflows" })}
                  onTestFirst={() => selectedApi && void runSelectedApi(selectedApi)}
                  apiPacks={API_PACKS}
                  catalog={catalog}
                  recentSearches={recentSearches}
                />
              )}

              {view === "catalog" && (
                <CatalogPage
                  query={catalogQuery}
                  onQueryChange={setCatalogQuery}
                  categories={categories}
                  categoryFilter={categoryFilter}
                  setCategoryFilter={setCategoryFilter}
                  methodFilter={methodFilter}
                  setMethodFilter={setMethodFilter}
                  complexityFilter={complexityFilter}
                  setComplexityFilter={setComplexityFilter}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  sort={sort}
                  setSort={setSort}
                  apis={sortApis(visibleCatalog, sort)}
                  totalResults={filteredCatalog.length}
                  hasMore={visibleCatalog.length < filteredCatalog.length}
                  onLoadMore={() => setCatalogLimit((current) => current + 120)}
                  onOpen={(api) => {
                    setSelectedApi(api);
                    setActiveApiTab("overview");
                    navigate({ view: "catalog", apiId: api.id, tab: "overview" });
                  }}
                  onTest={(api) => {
                    setSelectedApi(api);
                    setActiveApiTab("overview");
                    navigate({ view: "playground", apiId: api.id });
                    void runSelectedApi(api);
                  }}
                  onSave={(api) => void addFavorite(api)}
                  favorites={favorites}
                  currentTier={settings.subscription_tier}
                  onRequestCheckout={(tier) => {
                    const target = selectedApi ?? catalog.find((item) => item.requiredTier === tier) ?? catalog[0] ?? null;
                    if (target) {
                      promptCheckout(target, tier);
                    }
                  }}
                />
              )}

              {view === "playground" && (
                <PlaygroundPage
                  api={selectedApi}
                  response={response}
                  loading={loadingApi}
                  requestBody={requestBody}
                  setRequestBody={setRequestBody}
                  requestHeaders={requestHeaders}
                  setRequestHeaders={setRequestHeaders}
                  requestParams={requestParams}
                  setRequestParams={setRequestParams}
                  requestMethod={requestMethod}
                  setRequestMethod={setRequestMethod}
                  environment={environment}
                  setEnvironment={setEnvironment}
                  onRun={() => void runSelectedApi(selectedApi)}
                  onSaveRequest={() => void saveCurrentRequest()}
                  onCopyResponse={() => void copyCurrentResponse()}
                  onSaveResponse={() => void saveCurrentResponse()}
                  currentTier={settings.subscription_tier}
                  onRequestCheckout={(tier) => selectedApi && promptCheckout(selectedApi, tier)}
                />
              )}

              {view === "collections" && (
                <>
                  <CollectionsPage
                    collections={collections}
                    selectedCollection={selectedCollection}
                    collectionSearch={collectionSearch}
                    setCollectionSearch={setCollectionSearch}
                    collectionName={collectionName}
                    setCollectionName={setCollectionName}
                    collectionDescription={collectionDescription}
                    setCollectionDescription={setCollectionDescription}
                    collectionTheme={collectionTheme}
                    setCollectionTheme={setCollectionTheme}
                    onCreate={() => void saveSelectedApiToCollection()}
                    onDuplicate={(id) => void duplicateCollection(id)}
                    onExport={(id) => void exportCollection(id)}
                    onImport={() => collectionsImportRef.current?.click()}
                    onOpenApi={(apiId) => {
                      const api = catalog.find((item) => item.id === apiId);
                      if (api) {
                        setSelectedApi(api);
                        navigate({ view: "catalog", apiId: api.id, tab: "overview" });
                      }
                    }}
                  />
                  <input
                    ref={collectionsImportRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void importCollectionFile(file);
                      }
                      event.target.value = "";
                    }}
                  />
                </>
              )}

              {view === "workflows" && (
                <>
                  <WorkflowPage
                    workflows={workflows}
                    selectedWorkflow={selectedWorkflow}
                    draft={workflowDraft}
                    setDraft={setWorkflowDraft}
                    workflowName={workflowName}
                    setWorkflowName={setWorkflowName}
                    workflowDescription={workflowDescription}
                    setWorkflowDescription={setWorkflowDescription}
                    catalog={catalog}
                    onRunStep={(index) => void runWorkflowStep(index)}
                    onRunAll={() => void runFullWorkflow()}
                    onSave={() => void saveCurrentWorkflow()}
                    onDuplicate={(id) => void duplicateWorkflow(id)}
                    onExport={(id) => void exportWorkflow(id)}
                    onImport={() => workflowsImportRef.current?.click()}
                    onSelectWorkflow={(workflowId) => navigate({ view: "workflows", workflowId })}
                    onSetSelectedApi={(apiId) => {
                      const api = catalog.find((item) => item.id === apiId);
                      if (api) {
                        setSelectedApi(api);
                        navigate({ view: "catalog", apiId: api.id, tab: "overview" });
                      }
                    }}
                  />
                  <input
                    ref={workflowsImportRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void importWorkflowFile(file);
                      }
                      event.target.value = "";
                    }}
                  />
                </>
              )}

              {view === "settings" && (
                <SettingsPage
                  settings={settingsDraft}
                  setSettings={setSettingsDraft}
                  account={account}
                  onSave={() => void saveSettingsChanges()}
                  onRequestCheckout={(tier) => {
                    const target = selectedApi ?? catalog.find((item) => item.requiredTier === tier) ?? catalog[0] ?? null;
                    if (target) {
                      promptCheckout(target, tier);
                    }
                  }}
                />
              )}
            </section>

            {view !== "playground" && (
              <aside className="min-h-0 overflow-auto border-l border-slate-200/60 bg-white px-4 py-5 md:px-6 xl:px-7">
                <ApiDetailPanel
                  api={selectedApi}
                  tab={activeApiTab}
                  setTab={(tab) => {
                    setActiveApiTab(tab);
                    navigate({
                      view: "catalog",
                      apiId: selectedApi?.id ?? route.apiId,
                      tab,
                      requestId: tab === "history" ? route.requestId : undefined,
                    });
                  }}
                  onOpenPlayground={() => {
                    const apiId = selectedApi?.id ?? route.apiId;
                    if (apiId) {
                      navigate({ view: "playground", apiId });
                    }
                  }}
                  response={response}
                  loading={loadingApi}
                  requestBody={requestBody}
                  setRequestBody={setRequestBody}
                  requestHeaders={requestHeaders}
                  setRequestHeaders={setRequestHeaders}
                  requestParams={requestParams}
                  setRequestParams={setRequestParams}
                  requestMethod={requestMethod}
                  setRequestMethod={setRequestMethod}
                  environment={environment}
                  setEnvironment={setEnvironment}
                  onRun={() => void runSelectedApi(selectedApi)}
                  onSaveRequest={() => void saveCurrentRequest()}
                  onFavorite={() => selectedApi && void addFavorite(selectedApi)}
                  onRequestCheckout={(tier) => selectedApi && promptCheckout(selectedApi, tier)}
                  isFavorite={selectedApi ? favorites.includes(selectedApi.id) : false}
                  recentTests={requestHistory}
                  savedRequests={savedRequests}
                  selectedSavedRequestId={selectedSavedRequest?.id}
                  onOpenSavedRequest={(id, apiId) => navigate({ view: "catalog", apiId, tab: "history", requestId: id })}
                  savedResults={savedResults}
                  currentSnippet={currentSnippet}
                  currentTier={settings.subscription_tier}
                  onCopyResponse={() => void copyCurrentResponse()}
                  onSaveResponse={() => void saveCurrentResponse()}
                />
              </aside>
            )}
          </main>
        </div>
      </div>

      {searchOpen && (
        <SearchOverlay
          query={query}
          setQuery={setQuery}
          recentSearches={recentSearches}
          results={searchResults}
          onClose={() => setSearchOpen(false)}
          onPickApi={(api) => {
            setSelectedApi(api);
            setActiveApiTab("overview");
            navigate({ view: "catalog", apiId: api.id, tab: "overview" });
          }}
          onPickCategory={(_id, name) => {
            setCatalogQuery(name);
            navigate({ view: "catalog", search: name });
          }}
          onPickCollection={(id, name) => {
            setCollectionSearch(name);
            navigate({ view: "collections", collectionId: id });
          }}
          onPickWorkflow={(id) => {
            navigate({ view: "workflows", workflowId: id });
          }}
          onPickSearch={(value) => {
            setQuery(value);
            setCatalogQuery(value);
            navigate({ view: "catalog", search: value });
          }}
        />
      )}

      {checkoutApi && (
        <CheckoutModal
          api={checkoutApi}
          selectedTier={checkoutTier}
          onClose={() => setCheckoutApi(null)}
          onSelectTier={setCheckoutTier}
          onStartCheckout={() => void beginCheckout()}
          onCompleteCheckout={() => void finalizeCheckout()}
          currentTier={settings.subscription_tier}
          checkoutSession={checkoutSession}
          recentReceipts={checkoutReceipts}
          errorMessage={checkoutError}
        />
      )}

      {coinApi && (
        <CoinModal
          api={coinApi}
          reason={coinReason}
          balance={account?.apiCoinBalance ?? 0}
          onClose={() => setCoinApi(null)}
          onSpend={() => void completeCoinSpend()}
        />
      )}
    </div>
  );
}

function Dashboard({
  query,
  setQuery,
  statsRow,
  recommendations,
  categories,
  onOpenCatalog,
  onOpenCollections,
  onOpenWorkflows,
  onTestFirst,
  apiPacks,
  catalog,
  recentSearches,
}: {
  query: string;
  setQuery: (value: string) => void;
  statsRow: Array<{ label: string; value: string; note: string }>;
  recommendations: ApiDefinition[];
  categories: Category[];
  onOpenCatalog: () => void;
  onOpenCollections: () => void;
  onOpenWorkflows: () => void;
  onTestFirst: () => void;
  apiPacks: typeof API_PACKS;
  catalog: ApiDefinition[];
  recentSearches: string[];
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="overflow-hidden rounded-[32px] border border-slate-200/60 bg-gradient-to-br from-white via-white to-blue-50/70 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)] md:p-7">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">Magnexis APIHub</div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">Welcome to Magnexis APIHub</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">Explore, test, combine, and build with 700+ custom Magnexis APIs.</p>
            <div className="mt-5">
              <button
                type="button"
                onClick={onOpenCatalog}
                className="w-full rounded-[24px] border border-blue-100/70 bg-white px-5 py-4 text-left text-slate-500 shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition hover:border-blue-100 hover:shadow-[0_10px_22px_rgba(15,23,42,0.06)] md:max-w-3xl"
              >
                Search APIs, categories, endpoints, workflows, or tools
              </button>
            </div>
          </div>
        </div>

        <Panel title="Workspace snapshot" subtitle="A quick glance at what is ready right now.">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Featured API</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{recommendations[0]?.name ?? catalog[0]?.name ?? "Magnexis API"}</div>
                <div className="mt-1 text-xs text-slate-500">{recommendations[0]?.endpoint ?? catalog[0]?.endpoint ?? "/api/..."}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Next step</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">Open the catalog</div>
                <div className="mt-1 text-xs text-slate-500">Browse featured APIs, packs, and categories.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Launch path</div>
              <div className="mt-3 space-y-2">
                {[
                  "1. Search or browse an API",
                  "2. Open the playground",
                  "3. Save a request or result",
                ].map((item) => (
                  <div key={item} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {QUICK_ACTIONS.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => {
              if (card.view === "catalog") onOpenCatalog();
              if (card.view === "collections") onOpenCollections();
              if (card.view === "workflows") onOpenWorkflows();
            }}
            className="rounded-[24px] border border-slate-200/60 bg-white p-4 text-left shadow-[0_6px_16px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_22px_rgba(15,23,42,0.06)]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-xl font-semibold text-blue-600">M</div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p>
          </button>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">Stats</h2>
            <p className="text-sm text-slate-500">A quick look at your local Magnexis workspace.</p>
          </div>
          <button type="button" onClick={onTestFirst} className="rounded-full bg-blue-400 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_18px_rgba(66,133,244,0.08)]">
            Test selected API
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {statsRow.map((item) => (
            <StatCard key={item.label} {...item} />
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Recommended APIs" subtitle="Smart picks based on usage and favorites.">
          <div className="space-y-2">
            {recommendations.slice(0, 5).map((api) => (
              <CompactApiRow key={api.id} api={api} />
            ))}
          </div>
        </Panel>
        <Panel title="API Packs" subtitle="Curated bundles that make the catalog feel organized.">
          <div className="grid gap-3 md:grid-cols-2">
            {apiPacks.map((pack) => (
              <div key={pack.name} className="rounded-2xl border border-slate-200/60 bg-slate-50 p-4">
                <div className={`inline-flex rounded-full px-3 py-1 text-xs font-medium capitalize ${packBadge(pack.color)}`}>{pack.name.split(" ")[0]}</div>
                <h3 className="mt-3 font-semibold text-slate-900">{pack.name}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{pack.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {pack.apiIds.slice(0, 4).map((id) => (
                    <span key={id} className="rounded-full bg-white px-3 py-1 text-[11px] text-slate-500 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                      {apiLabelFromId(id)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Panel title="Categories" subtitle="The Magnexis registry grouped into a clean product hierarchy.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <button key={category.id} className="rounded-2xl border border-slate-200/60 bg-white p-4 text-left shadow-[0_4px_10px_rgba(15,23,42,0.04)] transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]" onClick={onOpenCatalog}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${categoryIconClass(category.id)}`}>{category.name[0]}</div>
                  <div>
                    <div className="font-medium text-slate-900">{category.name}</div>
                    <div className="text-sm text-slate-500">{category.count} APIs</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Recent Searches" subtitle="Google-style memory for your local workspace.">
          <div className="space-y-2">
            {recentSearches.length ? (
              recentSearches.map((item) => (
                <div key={item} className="rounded-2xl border border-slate-200/60 bg-white px-4 py-3 text-sm text-slate-700 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                  {item}
                </div>
              ))
            ) : (
              <div className="space-y-3">
                <EmptyState title="No recent searches yet" description="Start searching APIs, collections, workflows, or docs." />
                <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Try these</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["text", "developer", "seo", "invoice", "security", "game"].map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => {
                          setQuery(term);
                          onOpenCatalog();
                        }}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 transition hover:bg-blue-50 hover:text-blue-600"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Popular APIs" subtitle="High-visibility APIs that are ready to open right now.">
          <div className="space-y-2">
            {(recommendations.length ? recommendations : catalog).slice(0, 6).map((api) => (
              <CompactApiRow key={api.id} api={api} />
            ))}
          </div>
        </Panel>
        <Panel title="Quick start checklist" subtitle="A simple path to get moving immediately.">
          <div className="space-y-3">
            {[
              "Claim your Magnexis API Coin and confirm your account",
              "Open a featured API from the catalog",
              "Save a request to a collection",
              "Chain a short workflow together",
            ].map((item, index) => (
              <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-200/60 bg-white px-4 py-3 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-500">{index + 1}</div>
                <div className="text-sm text-slate-700">{item}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function CatalogPage({
  query,
  onQueryChange,
  categories,
  categoryFilter,
  setCategoryFilter,
  methodFilter,
  setMethodFilter,
  complexityFilter,
  setComplexityFilter,
  statusFilter,
  setStatusFilter,
  sort,
  setSort,
  apis,
  totalResults,
  hasMore,
  onLoadMore,
  onOpen,
  onTest,
  onSave,
  favorites,
  currentTier,
  onRequestCheckout,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  categories: Category[];
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  methodFilter: string;
  setMethodFilter: (value: string) => void;
  complexityFilter: string;
  setComplexityFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  sort: SortMode;
  setSort: (value: SortMode) => void;
  apis: ApiDefinition[];
  totalResults: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (api: ApiDefinition) => void;
  onTest: (api: ApiDefinition) => void;
  onSave: (api: ApiDefinition) => void;
  favorites: string[];
  currentTier: Settings["subscription_tier"];
  onRequestCheckout: (tier: Settings["subscription_tier"]) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const itemHeight = 204;
  const overscan = 4;
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemHeight));
  const maxScrollTop = Math.max(0, apis.length * itemHeight - viewportHeight);
  const safeScrollTop = Math.min(scrollTop, maxScrollTop);
  const startIndex = Math.max(0, Math.floor(safeScrollTop / itemHeight) - overscan);
  const endIndex = Math.min(apis.length, startIndex + visibleCount + overscan * 2);
  const visibleApis = apis.slice(startIndex, endIndex);
  const topSpacer = startIndex * itemHeight;
  const bottomSpacer = Math.max(0, (apis.length - endIndex) * itemHeight);

  useEffect(() => {
    setScrollTop(0);
  }, [query, categoryFilter, methodFilter, complexityFilter, statusFilter, sort]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    const update = () => setViewportHeight(node.clientHeight || 720);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [apis.length]);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">API Catalog</h2>
            <p className="text-sm text-slate-500">Browse Magnexis APIs like a polished cloud library.</p>
          </div>
          <div className="text-sm text-slate-500">{totalResults} results</div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Select value={categoryFilter} onChange={setCategoryFilter} options={[{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
          <Select value={methodFilter} onChange={setMethodFilter} options={[{ value: "all", label: "All methods" }, { value: "GET", label: "GET" }, { value: "POST", label: "POST" }]} />
          <Select value={complexityFilter} onChange={setComplexityFilter} options={[{ value: "all", label: "Any complexity" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
          <Select value={sort} onChange={setSort} options={[{ value: "popular", label: "Popular" }, { value: "a-z", label: "A-Z" }, { value: "newest", label: "Newest" }, { value: "fastest", label: "Fastest" }, { value: "recent", label: "Recently used" }]} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "Any status" }, { value: "featured", label: "Featured" }, { value: "recent", label: "Recently added" }, { value: "saved", label: "Saved" }]} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search API name, endpoint, tag, or type" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" />
        </div>
      </section>

      <section
        ref={listRef}
        className="max-h-[72vh] space-y-3 overflow-auto pr-1"
        onScroll={(event) => setScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: topSpacer }} aria-hidden="true" />
        {visibleApis.map((api) => (
          <article key={api.id} className="rounded-[24px] border border-slate-200/60 bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.04)] transition hover:shadow-[0_10px_22px_rgba(15,23,42,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-500">{api.category}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${methodBadge(api.method)}`}>{api.method}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{api.complexity}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${tierRank(currentTier) >= tierRank(api.requiredTier) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-600"}`}>
                    {tierRank(currentTier) >= tierRank(api.requiredTier) ? "Unlocked" : `Requires ${tierLabel(api.requiredTier)}`}
                  </span>
                  {api.polished && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">Featured</span>}
                </div>
                <h3 className="mt-3 text-[22px] font-semibold tracking-tight text-slate-900">{api.name}</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{api.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <code className="rounded-full bg-slate-50 px-3 py-1">{api.endpoint}</code>
                  <span className="rounded-full bg-slate-100 px-3 py-1">Limit {api.rateLimitPerMinute}/min</span>
                  <span>Tags: {api.tags.slice(0, 4).join(", ")}</span>
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <button type="button" onClick={() => onOpen(api)} className="rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-[0_2px_6px_rgba(15,23,42,0.04)] sm:py-2">
                  Open
                </button>
                {canAccessApi(api, currentTier) ? (
                  <button type="button" onClick={() => onTest(api)} className="rounded-full bg-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.08)] sm:py-2">
                    Test
                  </button>
                ) : (
                  <button type="button" onClick={() => onRequestCheckout(api.requiredTier)} className="rounded-full bg-amber-400 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(245,158,11,0.08)] sm:py-2">
                    Unlock
                  </button>
                )}
                <button type="button" onClick={() => onSave(api)} className="rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-[0_2px_6px_rgba(15,23,42,0.04)] sm:py-2">
                  {favorites.includes(api.id) ? "Saved" : "Save"}
                </button>
              </div>
            </div>
          </article>
        ))}
        <div style={{ height: bottomSpacer }} aria-hidden="true" />
      </section>
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button onClick={onLoadMore} className="rounded-full border border-slate-200/70 bg-white px-5 py-3 text-sm text-slate-700 shadow-[0_4px_10px_rgba(15,23,42,0.04)]">
            Load more results
          </button>
        </div>
      )}
    </div>
  );
}

function CollectionsPage({
  collections,
  selectedCollection,
  collectionSearch,
  setCollectionSearch,
  collectionName,
  setCollectionName,
  collectionDescription,
  setCollectionDescription,
  collectionTheme,
  setCollectionTheme,
  onCreate,
  onDuplicate,
  onExport,
  onImport,
  onOpenApi,
}: {
  collections: Array<{ id: string; name: string; description?: string; color?: string; items: { apiId: string; note?: string }[]; updatedAt?: string }>;
  selectedCollection: { id: string; name: string; description?: string; color?: string; items: { apiId: string; note?: string }[]; updatedAt?: string } | null;
  collectionSearch: string;
  setCollectionSearch: (value: string) => void;
  collectionName: string;
  setCollectionName: (value: string) => void;
  collectionDescription: string;
  setCollectionDescription: (value: string) => void;
  collectionTheme: string;
  setCollectionTheme: (value: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onImport: () => void;
  onOpenApi: (apiId: string) => void;
}) {
  const filtered = collections.filter((collection) => [collection.name, collection.description, collection.id].join(" ").toLowerCase().includes(collectionSearch.toLowerCase()));

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">Collections</h2>
        <p className="mt-2 text-sm text-slate-500">Like Google Drive folders, but for Magnexis APIs.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input value={collectionSearch} onChange={(event) => setCollectionSearch(event.target.value)} placeholder="Search collections" className="rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm outline-none" />
          <div className="text-sm text-slate-500">{collections.length} collections</div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {filtered.map((collection) => (
          <article key={collection.id} className="rounded-[24px] border border-slate-200/60 bg-white p-5 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className={`mt-1 h-12 w-12 rounded-2xl ${collectionThemeBadge(collection.color ?? "blue")}`} />
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">{collection.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{collection.description}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-400">{collection.items.length} APIs</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => onDuplicate(collection.id)} className="rounded-full border border-slate-200/70 px-3 py-3 text-sm sm:py-2">
                  Duplicate
                </button>
                <button type="button" onClick={() => onExport(collection.id)} className="rounded-full border border-slate-200/70 px-3 py-3 text-sm sm:py-2">
                  Export
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {collection.items.map((item) => (
                <button type="button" key={item.apiId} onClick={() => onOpenApi(item.apiId)} className="rounded-full bg-slate-100 px-3 py-3 text-xs text-slate-700 sm:py-1">
                  {apiLabelFromId(item.apiId)}
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-[28px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <h3 className="text-[22px] font-semibold tracking-tight text-slate-900">Create Collection</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="Collection name" className="rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm outline-none" />
          <input value={collectionDescription} onChange={(event) => setCollectionDescription(event.target.value)} placeholder="Description" className="rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm outline-none" />
          <select value={collectionTheme} onChange={(event) => setCollectionTheme(event.target.value)} className="rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm outline-none">
            <option value="blue">Blue</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="violet">Violet</option>
            <option value="rose">Rose</option>
          </select>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onCreate} className="rounded-full bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.09)] sm:py-2">
            Save selected API
          </button>
          <button type="button" onClick={onImport} className="rounded-full border border-slate-200/70 px-4 py-3 text-sm sm:py-2">
            Import JSON
          </button>
          <button
            type="button"
            onClick={() => {
              const sample = selectedCollection?.items[0]?.apiId;
            if (sample) {
              onOpenApi(sample);
            }
          }}
          className="rounded-full border border-slate-200/70 px-4 py-3 text-sm sm:py-2"
        >
          Open collection sample
        </button>
      </div>
    </section>
    </div>
  );
}

function WorkflowPage({
  workflows,
  selectedWorkflow,
  draft,
  setDraft,
  workflowName,
  setWorkflowName,
  workflowDescription,
  setWorkflowDescription,
  catalog,
  onRunStep,
  onRunAll,
  onSave,
  onDuplicate,
  onExport,
  onImport,
  onSelectWorkflow,
  onSetSelectedApi,
}: {
  workflows: Array<{ id: string; name: string; description?: string; steps: Array<string | { apiId: string; inputMap?: string; outputMap?: string }> }>;
  selectedWorkflow: { id: string; name: string; description?: string; steps: Array<string | { apiId: string; inputMap?: string; outputMap?: string }> } | null;
  draft: WorkflowStep[];
  setDraft: (value: WorkflowStep[]) => void;
  workflowName: string;
  setWorkflowName: (value: string) => void;
  workflowDescription: string;
  setWorkflowDescription: (value: string) => void;
  catalog: ApiDefinition[];
  onRunStep: (index: number) => void;
  onRunAll: () => void;
  onSave: () => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onImport: () => void;
  onSelectWorkflow: (workflowId: string) => void;
  onSetSelectedApi: (apiId: string) => void;
}) {
  const workflowApiOptions = useMemo(() => {
    const base = new Map<string, ApiDefinition>();
    for (const api of catalog) {
      if (base.size >= 120) {
        break;
      }
      if (api.polished || base.size < 60) {
        base.set(api.id, api);
      }
    }
    return base;
  }, [catalog]);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">Workflow Builder</h2>
            <p className="mt-2 text-sm text-slate-500">Google Forms simplicity for ordered API pipelines.</p>
            {selectedWorkflow && (
              <div className="mt-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
                Selected: {selectedWorkflow.name}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={onRunAll} className="rounded-full bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.09)] sm:py-2">
              Run full workflow
            </button>
            <button type="button" onClick={onSave} className="rounded-full border border-slate-200/70 px-4 py-3 text-sm sm:py-2">
              Save workflow
            </button>
            <button
              type="button"
              onClick={() => {
                const source = selectedWorkflow ?? workflows[0] ?? null;
                setDraft(buildWorkflowDraft(source));
                setWorkflowName(source?.name ?? "");
                setWorkflowDescription(source?.description ?? "");
              }}
              className="rounded-full border border-slate-200/70 px-4 py-3 text-sm sm:py-2"
            >
              Load template
            </button>
            <button type="button" onClick={onImport} className="rounded-full border border-slate-200/70 px-4 py-3 text-sm sm:py-2">
              Import JSON
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Field label="Workflow name" value={workflowName} onChange={setWorkflowName} placeholder="My Magnexis workflow" />
          <Field label="Description" value={workflowDescription} onChange={setWorkflowDescription} placeholder="Short summary of this workflow" />
        </div>
      </section>

      <section className="space-y-3">
        {draft.map((step, index) => (
          <article key={`${step.apiId}-${index}`} className="rounded-[24px] border border-slate-200/60 bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Step {index + 1}</div>
                <select value={step.apiId} onChange={(event) => setDraft(draft.map((item, itemIndex) => (itemIndex === index ? { ...item, apiId: event.target.value, status: "ready" } : item)))} className="mt-2 max-w-[26rem] rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm">
                  {(() => {
                    const current = catalog.find((api) => api.id === step.apiId);
                    const options = new Map<string, ApiDefinition>();
                    if (current) {
                      options.set(current.id, current);
                    }
                    for (const api of workflowApiOptions.values()) {
                      options.set(api.id, api);
                    }
                    return Array.from(options.values()).map((api) => (
                    <option key={api.id} value={api.id}>
                      {api.name}
                    </option>
                    ));
                  })()}
                </select>
                <button
                  type="button"
                  onClick={() => onSetSelectedApi(step.apiId)}
                  className="mt-2 rounded-full border border-slate-200/70 px-3 py-2 text-xs text-slate-600"
                >
                  Open in catalog
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => onRunStep(index)} className="rounded-full border border-slate-200/70 px-3 py-3 text-sm sm:py-2">
                  Test step
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Field label="Input mapping" value={step.inputMap} onChange={(value) => setDraft(draft.map((item, itemIndex) => (itemIndex === index ? { ...item, inputMap: value } : item)))} placeholder="e.g. query.text -> body.text" />
              <Field label="Output mapping" value={step.outputMap} onChange={(value) => setDraft(draft.map((item, itemIndex) => (itemIndex === index ? { ...item, outputMap: value } : item)))} placeholder="e.g. data.summary -> next.prompt" />
              <Field label="Status" value={step.status} onChange={(value) => setDraft(draft.map((item, itemIndex) => (itemIndex === index ? { ...item, status: value as WorkflowStep["status"] } : item)))} placeholder="idle / ready / tested" />
            </div>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Result preview: {step.result || "No result yet."}</div>
          </article>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {workflows.map((workflow) => (
          <article key={workflow.id} className="rounded-[24px] border border-slate-200/60 bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{workflow.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{workflow.description}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" onClick={() => onSelectWorkflow(workflow.id)} className="rounded-full border border-slate-200/70 px-3 py-3 text-sm sm:py-2">
                  Open
                </button>
                <button type="button" onClick={() => onDuplicate(workflow.id)} className="rounded-full border border-slate-200/70 px-3 py-3 text-sm sm:py-2">
                  Duplicate
                </button>
                <button type="button" onClick={() => onExport(workflow.id)} className="rounded-full border border-slate-200/70 px-3 py-3 text-sm sm:py-2">
                  Export
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {workflow.steps.map((step) => {
                const stepId = workflowStepId(step);
                return (
                  <button key={stepId} onClick={() => onSetSelectedApi(stepId)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                    {apiLabelFromId(stepId)}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function SettingsPage({
  settings,
  setSettings,
  account,
  onSave,
  onRequestCheckout,
}: {
  settings: Settings;
  setSettings: (value: Settings) => void;
  account: Account | null;
  onSave: () => void;
  onRequestCheckout: (tier: Settings["subscription_tier"]) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">Settings</h2>
        <p className="mt-2 text-sm text-slate-500">Appearance, local server, registry, and privacy controls.</p>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingGroup title="Appearance">
          <Select value={settings.theme} onChange={(value) => setSettings({ ...settings, theme: value as Settings["theme"] })} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          <Select value={settings.response_format} onChange={(value) => setSettings({ ...settings, response_format: value as Settings["response_format"] })} options={[{ value: "json", label: "JSON" }, { value: "pretty", label: "Pretty" }, { value: "raw", label: "Raw" }]} />
        </SettingGroup>
        <SettingGroup title="Subscription">
          <Select
            value={settings.subscription_tier}
            onChange={(value) => setSettings({ ...settings, subscription_tier: value as Settings["subscription_tier"] })}
            options={[
              { value: "free", label: "Free" },
              { value: "pro", label: "Pro" },
              { value: "enterprise", label: "Enterprise" },
            ]}
          />
          <div className="rounded-2xl border border-blue-100/70 bg-blue-50 p-4 text-sm text-slate-700">
            Current plan: <span className="font-semibold text-blue-500">{tierLabel(settings.subscription_tier)}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <button
                key={plan.tier}
                type="button"
                onClick={() => onRequestCheckout(plan.tier)}
                className={`rounded-[22px] border p-4 text-left transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] ${settings.subscription_tier === plan.tier ? "border-blue-100/80 bg-blue-50 shadow-[0_4px_10px_rgba(66,133,244,0.06)]" : "border-slate-200/60 bg-white"}`}
              >
                <div className="text-sm font-semibold text-slate-900">{plan.label}</div>
                <div className="mt-1 text-base font-semibold tracking-tight text-slate-900">{plan.price}</div>
                <div className="mt-2 text-xs text-slate-500">{plan.description}</div>
              </button>
            ))}
          </div>
        </SettingGroup>
        <SettingGroup title="Account">
          <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">{account?.displayName ?? "Not signed up"}</div>
            <div className="mt-1 text-slate-500">{account?.email ?? "Create your Magnexis account to claim one API Coin."}</div>
            <div className="mt-3 rounded-full bg-white px-3 py-2 text-xs text-slate-600 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
              API Coin Balance: <span className="font-semibold text-blue-500">{account?.apiCoinBalance ?? 0}</span>
            </div>
          </div>
        </SettingGroup>
        <SettingGroup title="Local Server">
          <Field label="Port" value={String(settings.local_port)} onChange={(value) => setSettings({ ...settings, local_port: Number(value) || 8787 })} placeholder="8787" />
          <Toggle label="Auto-save requests" checked={settings.auto_save_requests} onChange={(checked) => setSettings({ ...settings, auto_save_requests: checked })} />
        </SettingGroup>
        <SettingGroup title="Collections">
          <Toggle label="Compact mode" checked={settings.compact_mode} onChange={(checked) => setSettings({ ...settings, compact_mode: checked })} />
        </SettingGroup>
        <SettingGroup title="Privacy">
          <Toggle label="Telemetry" checked={settings.telemetry} onChange={(checked) => setSettings({ ...settings, telemetry: checked })} />
        </SettingGroup>
        <SettingGroup title="API Registry">
          <Field label="Registry quality" value="700+ curated Magnexis APIs" onChange={() => undefined} placeholder="Registry score" />
          <Field label="Suggested default pack" value="Developer Starter Pack" onChange={() => undefined} placeholder="Suggested pack" />
        </SettingGroup>
        <SettingGroup title="About Magnexis APIHub">
          <div className="text-sm text-slate-600">Clean, local-first API console inspired by modern cloud products. Built for search, testing, collections, and workflow composition.</div>
        </SettingGroup>
      </div>
      <button onClick={onSave} className="rounded-full bg-blue-400 px-5 py-3 text-sm font-medium text-white">
        Save settings
      </button>
    </div>
  );
}

function ApiDetailPanel({
  api,
  tab,
  setTab,
  onOpenPlayground,
  response,
  loading,
  requestBody,
  setRequestBody,
  requestHeaders,
  setRequestHeaders,
  requestParams,
  setRequestParams,
  requestMethod,
  setRequestMethod,
  environment,
  setEnvironment,
  onRun,
  onSaveRequest,
  onFavorite,
  onRequestCheckout,
  isFavorite,
  recentTests,
  savedRequests,
  selectedSavedRequestId,
  onOpenSavedRequest,
  savedResults,
  currentSnippet,
  currentTier,
  onCopyResponse,
  onSaveResponse,
}: {
  api: ApiDefinition | null;
  tab: ApiTab;
  setTab: (value: ApiTab) => void;
  onOpenPlayground: () => void;
  response: ExecutionResult | null;
  loading: boolean;
  requestBody: string;
  setRequestBody: (value: string) => void;
  requestHeaders: string;
  setRequestHeaders: (value: string) => void;
  requestParams: string;
  setRequestParams: (value: string) => void;
  requestMethod: "GET" | "POST";
  setRequestMethod: (value: "GET" | "POST") => void;
  environment: string;
  setEnvironment: (value: string) => void;
  onRun: () => void;
  onSaveRequest: () => void;
  onFavorite: () => void;
  onRequestCheckout: (tier: Settings["subscription_tier"]) => void;
  isFavorite: boolean;
  recentTests: ExecutionResult[];
  savedRequests: Array<{ id: string; name: string; apiId: string; method: string }>;
  selectedSavedRequestId?: string | null;
  onOpenSavedRequest: (id: string, apiId: string) => void;
  savedResults: SavedResult[];
  currentSnippet: string;
  currentTier: Settings["subscription_tier"];
  onCopyResponse: () => void;
  onSaveResponse: () => void;
}) {
  if (!api) {
    return <EmptyState title="Select an API" description="Open an API from the catalog to see documentation and the playground." />;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-500">{api.category}</div>
            <h2 className="mt-3 text-[22px] font-semibold tracking-tight text-slate-900">{api.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{api.description}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button onClick={onFavorite} className={`rounded-full px-4 py-2 text-sm ${isFavorite ? "bg-amber-50 text-amber-600" : "border border-slate-200/70 bg-white text-slate-700"}`}>
              {isFavorite ? "Favorited" : "Favorite"}
            </button>
            <button
              type="button"
              onClick={() => onRequestCheckout(api.requiredTier)}
              className={`rounded-full px-4 py-2 text-xs font-medium ${canAccessApi(api, currentTier) ? "border border-slate-200/70 bg-white text-slate-500" : "bg-amber-400 text-white"}`}
            >
              {canAccessApi(api, currentTier) ? `Plan: ${tierLabel(api.requiredTier)}` : `Unlock ${tierLabel(api.requiredTier)}`}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          <code className="rounded-full bg-slate-100 px-3 py-1">{api.endpoint}</code>
          {api.endpointVariants?.slice(0, 3).map((variant) => (
            <span key={variant} className="rounded-full bg-slate-100 px-3 py-1">
              {variant}
            </span>
          ))}
          <span className={`rounded-full px-3 py-1 ${methodBadge(api.method)}`}>{api.method}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{api.complexity}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">Limit {api.rateLimitPerMinute}/min</span>
          <span className={`rounded-full px-3 py-1 ${tierRank(currentTier) >= tierRank(api.requiredTier) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-600"}`}>
            {tierRank(currentTier) >= tierRank(api.requiredTier) ? "Unlocked" : `Requires ${tierLabel(api.requiredTier)}`}
          </span>
        </div>
        <button onClick={onOpenPlayground} className="mt-3 text-sm font-medium text-blue-500 hover:text-blue-600">
          Visit in Playground 2.0
        </button>
      </section>

      <section className="rounded-[24px] border border-slate-200/60 bg-white p-3 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap gap-1">
          {(["overview", "request", "response", "examples", "errors", "code", "history"] as ApiTab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`rounded-full px-4 py-2 text-sm ${tab === item ? "bg-blue-400 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {capitalize(item)}
            </button>
          ))}
        </div>
      </section>

      {tab === "overview" && (
        <Panel title="Overview" subtitle="Professional documentation for the selected Magnexis API.">
          <div className="space-y-4 text-sm text-slate-600">
            <InfoRow label="What it does" value={api.description} />
            <InfoRow label="When to use it" value="Use when you want a deterministic Magnexis-local result for this category." />
            <InfoRow label="Endpoint variants" value={api.endpointVariants?.length ? api.endpointVariants.join("\n") : api.endpoint} mono />
            <InfoRow label="Rate limit" value={`${api.rateLimitPerMinute} requests per minute`} />
            <InfoRow label="Input schema" value={JSON.stringify(api.inputSchema, null, 2)} mono />
            <InfoRow label="Output schema" value={JSON.stringify(api.outputSchema, null, 2)} mono />
            <InfoRow label="Example use cases" value={api.examples.map((example) => Object.keys(example.request).join(", ")).join(" | ")} />
            <InfoRow label="Related APIs" value={api.tags.slice(0, 4).join(", ")} />
          </div>
        </Panel>
      )}

      {tab === "request" && (
        <Panel title="Request" subtitle="Inspect the request payload, method, and endpoint.">
          <pre className="rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">{JSON.stringify({ method: requestMethod, endpoint: api.endpoint, headers: safeJson(requestHeaders), query: safeJson(requestParams), body: safeJson(requestBody) }, null, 2)}</pre>
        </Panel>
      )}

      {tab === "response" && (
        <Panel title="Response" subtitle="The last execution result, headers, and timing.">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <InfoRow label="Status" value={String(response?.statusCode ?? "idle")} />
              <InfoRow label="Latency" value={`${response?.latencyMs ?? 0} ms`} />
              <InfoRow label="Request ID" value={response?.requestId ?? "pending"} mono />
            </div>
            <pre className="rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">{JSON.stringify(response ?? { note: "No response yet." }, null, 2)}</pre>
          </div>
        </Panel>
      )}

      {tab === "examples" && (
        <Panel title="Examples" subtitle="Request and response examples generated from the Magnexis registry.">
          <div className="space-y-3">
            {api.examples.map((example, index) => (
              <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Example {index + 1}</div>
                <pre className="mt-2 overflow-auto rounded-xl bg-white p-3 text-xs">{JSON.stringify(example, null, 2)}</pre>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === "errors" && (
        <Panel title="Errors" subtitle="Common error examples and how they surface in the playground.">
          <div className="space-y-3 text-sm text-slate-600">
            <ErrorRow code="400" message="Invalid JSON body or malformed parameters." />
            <ErrorRow code="404" message="API definition not found in the Magnexis registry." />
            <ErrorRow code="429" message="Rate limit simulation triggered for high-frequency requests." />
          </div>
        </Panel>
      )}

      {tab === "code" && (
        <Panel title="Code" subtitle="Working request snippet for the selected API.">
          <pre className="overflow-auto rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">{currentSnippet}</pre>
        </Panel>
      )}

      {tab === "history" && (
        <Panel title="History" subtitle="Recent tests and saved requests.">
          <div className="space-y-3">
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Recent tests</div>
              <div className="space-y-2">
                {recentTests.slice(0, 5).map((item) => (
                  <div key={item.requestId} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    {item.endpoint} - {item.statusCode} - {item.latencyMs} ms
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Saved requests</div>
              <div className="space-y-2">
                {savedRequests.slice(0, 5).map((item) => (
                  <button
                    type="button"
                    onClick={() => onOpenSavedRequest(item.id, item.apiId)}
                    key={item.id}
                    className={`rounded-2xl px-4 py-3 text-sm ${selectedSavedRequestId === item.id ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100" : "bg-slate-50 text-slate-600"}`}
                  >
                    {item.name} - {item.method}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Saved results</div>
              <div className="space-y-2">
                {savedResults.slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    {item.name} - {item.statusCode} - {item.savedAt.slice(0, 19).replace("T", " ")}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

function PlaygroundPage({
  api,
  response,
  loading,
  requestBody,
  setRequestBody,
  requestHeaders,
  setRequestHeaders,
  requestParams,
  setRequestParams,
  requestMethod,
  setRequestMethod,
  environment,
  setEnvironment,
  onRun,
  onSaveRequest,
  onCopyResponse,
  onSaveResponse,
  currentTier,
  onRequestCheckout,
}: {
  api: ApiDefinition | null;
  response: ExecutionResult | null;
  loading: boolean;
  requestBody: string;
  setRequestBody: (value: string) => void;
  requestHeaders: string;
  setRequestHeaders: (value: string) => void;
  requestParams: string;
  setRequestParams: (value: string) => void;
  requestMethod: "GET" | "POST";
  setRequestMethod: (value: "GET" | "POST") => void;
  environment: string;
  setEnvironment: (value: string) => void;
  onRun: () => void;
  onSaveRequest: () => void;
  onCopyResponse: () => void;
  onSaveResponse: () => void;
  currentTier: Settings["subscription_tier"];
  onRequestCheckout: (tier: Settings["subscription_tier"]) => void;
}) {
  if (!api) {
    return <EmptyState title="Select an API" description="Choose an API in the catalog to open its dedicated playground." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200/60 bg-white p-6 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-500">Playground 2.0</div>
            <h2 className="mt-3 text-[30px] font-semibold tracking-tight text-slate-900">{api.name}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{api.description}</p>
          </div>
          <button
            onClick={onRun}
            className={`rounded-full px-5 py-3 text-sm font-medium text-white ${canAccessApi(api, currentTier) ? "bg-blue-400 shadow-[0_6px_14px_rgba(66,133,244,0.08)]" : "bg-amber-300 shadow-[0_6px_14px_rgba(245,158,11,0.07)]"}`}
          >
            {loading ? "Running..." : canAccessApi(api, currentTier) ? "Send" : `Unlock ${tierLabel(api.requiredTier)}`}
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-500">
          <code className="rounded-full bg-slate-100 px-3 py-1">{api.endpoint}</code>
          <span className={`rounded-full px-3 py-1 ${methodBadge(api.method)}`}>{api.method}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">Limit {api.rateLimitPerMinute}/min</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{api.complexity}</span>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.5fr)]">
        <div className="space-y-6">
          <section className="rounded-[32px] border border-slate-200/60 bg-white p-6 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Select value={requestMethod} onChange={setRequestMethod} options={[{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }]} />
              <Select value={environment} onChange={setEnvironment} options={[{ value: "Local", label: "Local" }, { value: "Staging", label: "Staging" }, { value: "Prod", label: "Production" }]} />
              <Field label="URL" value={api.endpoint} onChange={() => undefined} placeholder={api.endpoint} />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <Editor label="Params" value={requestParams} onChange={setRequestParams} />
              <Editor label="Headers" value={requestHeaders} onChange={setRequestHeaders} />
            </div>
            <div className="mt-4">
              <Editor label="JSON Body" value={requestBody} onChange={setRequestBody} />
            </div>
          </section>

          <section className="rounded-[32px] border border-slate-200/60 bg-white p-6 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[18px] font-semibold tracking-tight text-slate-900">Response Viewer</div>
                <div className="text-sm text-slate-500">Pretty JSON, raw output, and execution metadata.</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" onClick={onCopyResponse} className="rounded-full border border-slate-200/70 bg-white px-3 py-3 text-xs sm:py-2">
                  Copy response
                </button>
                <button type="button" onClick={onSaveResponse} className="rounded-full border border-slate-200/70 bg-white px-3 py-3 text-xs sm:py-2">
                  Save result
                </button>
                <button type="button" onClick={onSaveRequest} className="rounded-full border border-slate-200/70 bg-white px-3 py-3 text-xs sm:py-2">
                  Save request
                </button>
              </div>
            </div>
            <pre className="min-h-[32rem] max-h-[40rem] overflow-auto rounded-[24px] bg-slate-50 p-5 text-xs leading-6 text-slate-700 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
              {JSON.stringify(response?.data ?? { note: "Run the API to view response data." }, null, 2)}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <Badge label={`Status ${response?.statusCode ?? "idle"}`} />
              <Badge label={`Latency ${response?.latencyMs ?? 0} ms`} />
              <Badge label={response?.requestId ?? "pending"} />
            </div>
            {response?.error?.message && (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{response.error.message}</div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-[32px] border border-slate-200/60 bg-white p-6 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
            <div className="text-lg font-semibold tracking-tight text-slate-900">Smart Help</div>
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p>Required fields: {Object.keys(api.inputSchema?.properties ?? {}).join(", ") || "n/a"}</p>
              <p>Common errors: Missing body keys, malformed JSON, invalid query parameters.</p>
              <p>Next APIs: {api.tags.slice(0, 3).join(", ")}</p>
              <p>Response format: {response?.error ? "Error" : "Success"} / {response?.statusCode ?? "idle"}</p>
            </div>
            <button type="button" onClick={onSaveRequest} className="mt-5 rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm sm:py-2">
              Save request
            </button>
          </section>

          <section className="rounded-[32px] border border-slate-200/60 bg-blue-50 p-6 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
            <div className="text-lg font-semibold tracking-tight text-slate-900">Quick access</div>
            <p className="mt-2 text-sm text-slate-600">Use the selected Magnexis API directly in a larger workspace with the response viewer separated from the docs.</p>
          <button
            type="button"
            onClick={() => onRequestCheckout(api.requiredTier)}
            className={`mt-4 w-full rounded-full px-4 py-3 text-sm font-medium ${canAccessApi(api, currentTier) ? "border border-slate-200/70 bg-white text-slate-700" : "bg-amber-400 text-white"}`}
          >
              {canAccessApi(api, currentTier) ? `Plan: ${tierLabel(api.requiredTier)}` : `Unlock ${tierLabel(api.requiredTier)}`}
            </button>
          </section>
        </aside>
      </section>
    </div>
  );
}

function SearchOverlay({
  query,
  setQuery,
  recentSearches,
  results,
  onClose,
  onPickApi,
  onPickCategory,
  onPickCollection,
  onPickWorkflow,
  onPickSearch,
}: {
  query: string;
  setQuery: (value: string) => void;
  recentSearches: string[];
  results: SearchResult;
  onClose: () => void;
  onPickApi: (api: ApiDefinition) => void;
  onPickCategory: (id: string, name: string) => void;
  onPickCollection: (id: string, name: string) => void;
  onPickWorkflow: (id: string) => void;
  onPickSearch: (value: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/30 p-4 backdrop-blur-sm md:p-8">
      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200/60 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.14)]">
        <div className="border-b border-slate-200/60 p-4">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Magnexis APIs, categories, collections, workflows, docs..." className="w-full rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-4 text-sm outline-none" />
        </div>
        <div className="grid max-h-[72vh] grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-2">
          <SearchGroup title="APIs">
            {results.apis.slice(0, 6).map((api) => (
              <SearchItem key={api.id} title={api.name} subtitle={api.endpoint} onClick={() => onPickApi(api)} />
            ))}
          </SearchGroup>
          <SearchGroup title="Categories">
            {results.categories.slice(0, 6).map((category) => (
              <SearchItem key={category.id} title={category.name} subtitle={`${category.count} APIs`} onClick={() => onPickCategory(category.id, category.name)} />
            ))}
          </SearchGroup>
          <SearchGroup title="Collections">
            {results.collections.slice(0, 6).map((collection) => (
              <SearchItem key={collection.id} title={collection.name} subtitle={collection.description ?? "Collection"} onClick={() => onPickCollection(collection.id, collection.name)} />
            ))}
          </SearchGroup>
          <SearchGroup title="Workflows">
            {results.workflows.slice(0, 6).map((workflow) => (
              <SearchItem key={workflow.id} title={workflow.name} subtitle={workflow.description ?? "Workflow"} onClick={() => onPickWorkflow(workflow.id)} />
            ))}
          </SearchGroup>
          <SearchGroup title="Recent searches">
            {recentSearches.slice(0, 6).map((item) => (
              <SearchItem key={item} title={item} subtitle="Recent" onClick={() => onPickSearch(item)} />
            ))}
          </SearchGroup>
        </div>
        <div className="flex justify-end border-t border-slate-200/60 p-4">
          <button type="button" onClick={onClose} className="rounded-full border border-slate-200/70 px-4 py-3 text-sm sm:py-2">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckoutModal({
  api,
  selectedTier,
  onClose,
  onSelectTier,
  onStartCheckout,
  onCompleteCheckout,
  currentTier,
  checkoutSession,
  recentReceipts,
  errorMessage,
}: {
  api: ApiDefinition;
  selectedTier: Settings["subscription_tier"];
  onClose: () => void;
  onSelectTier: (tier: Settings["subscription_tier"]) => void;
  onStartCheckout: () => void;
  onCompleteCheckout: () => void;
  currentTier: Settings["subscription_tier"];
  checkoutSession: { receipt: CheckoutReceipt; checkoutUrl: string } | null;
  recentReceipts: CheckoutReceipt[];
  errorMessage: string | null;
}) {
  const selectedPlan = SUBSCRIPTION_PLANS.find((plan) => plan.tier === selectedTier) ?? SUBSCRIPTION_PLANS[0];
  const receipt = checkoutSession?.receipt ?? null;
  const receiptCopy = receipt
    ? [
        `Receipt: ${receipt.receiptNumber}`,
        `API: ${receipt.apiName}`,
        `Tier: ${tierLabel(receipt.tier)}`,
        `Amount: ${formatCurrency(receipt.amountCents, receipt.currency)}`,
        `Status: ${capitalize(receipt.status)}`,
        `Provider: ${capitalize(receipt.provider)}`,
      ].join("\n")
    : "";

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-[32px] border border-slate-200/60 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="p-6 md:p-8">
            <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-500">Checkout flow</div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{receipt ? "Square checkout ready" : `Unlock ${api.name}`}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              This API requires <span className="font-semibold text-slate-900">{tierLabel(api.requiredTier)}</span>. We now send you to Square first, then store a receipt before the tier changes.
            </p>

            <div className="mt-5 rounded-[24px] border border-slate-200/60 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">API summary</div>
              <div className="mt-2 text-base font-semibold tracking-tight text-slate-900">{api.endpoint}</div>
              <div className="mt-2 text-sm text-slate-600">{api.description}</div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-white px-3 py-1 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">{tierLabel(currentTier)} plan active</span>
                <span className="rounded-full bg-white px-3 py-1 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">Requires {tierLabel(api.requiredTier)}</span>
                <span className="rounded-full bg-white px-3 py-1 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">{api.method}</span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {SUBSCRIPTION_PLANS.map((plan) => (
                <button
                  key={plan.tier}
                  type="button"
                  onClick={() => onSelectTier(plan.tier)}
                  disabled={plan.tier === "free"}
                  className={`rounded-[24px] border p-4 text-left transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] ${selectedTier === plan.tier ? "border-blue-100/80 bg-blue-50 shadow-[0_4px_10px_rgba(66,133,244,0.06)]" : "border-slate-200/60 bg-white"} ${plan.tier === "free" ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <div className="text-sm font-semibold text-slate-900">{plan.label}</div>
                  <div className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">{plan.price}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-500">{plan.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200/60 bg-slate-50 p-6 lg:border-l lg:border-t-0 md:p-8">
            <div className="rounded-[26px] border border-slate-200/60 bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
              {!receipt ? (
                <>
                  {errorMessage && (
                    <div className="mb-4 rounded-[18px] border border-rose-200/70 bg-rose-50 p-4 text-sm text-rose-700">
                      {errorMessage}
                    </div>
                  )}
                  <div className="text-sm font-semibold text-slate-900">What you get</div>
                  <ul className="mt-4 space-y-3 text-sm text-slate-600">
                    {selectedPlan.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-500">
                          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3 w-3 fill-none stroke-current stroke-[2.5]">
                            <path d="M4 10l3 3 9-9" />
                          </svg>
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 rounded-[22px] bg-blue-50 p-4 text-sm text-slate-700">
                    Checkout opens a Square payment link first. We only unlock the tier after the receipt is created and payment is confirmed.
                  </div>
                  {errorMessage && (
                    <div className="mt-4 rounded-[18px] border border-rose-200/70 bg-rose-50 p-4 text-sm text-rose-700">
                      {errorMessage}
                    </div>
                  )}
                  <div className="mt-5 flex gap-3">
                    <button type="button" onClick={onClose} className="flex-1 rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm">
                      Cancel
                    </button>
                    <button type="button" onClick={onStartCheckout} className="flex-1 rounded-full bg-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.08)]">
                      Continue to Square
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-slate-900">Receipt preview</div>
                  <div className="mt-4 rounded-[24px] border border-slate-200/60 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Receipt number</div>
                    <div className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{receipt.receiptNumber}</div>
                    <div className="mt-4 grid gap-3 text-sm text-slate-600">
                      <InfoRow label="API" value={receipt.apiName} />
                      <InfoRow label="Plan" value={tierLabel(receipt.tier)} />
                      <InfoRow label="Amount" value={formatCurrency(receipt.amountCents, receipt.currency)} />
                      <InfoRow label="Status" value={capitalize(receipt.status)} />
                      <InfoRow label="Provider" value={capitalize(receipt.provider)} />
                      <InfoRow label="Checkout URL" value={receipt.checkoutUrl} mono />
                    </div>
                  </div>
                  <div className="mt-5 rounded-[22px] bg-blue-50 p-4 text-sm text-slate-700">
                    Open the Square link, finish payment, then click the confirmation button to apply the subscription tier locally.
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="button" onClick={onClose} className="flex-1 rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm">
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => openExternalUrl(receipt.checkoutUrl)}
                      className="flex-1 rounded-full border border-blue-100 bg-white px-4 py-3 text-sm font-medium text-blue-500"
                    >
                      Open Square again
                    </button>
                    <button type="button" onClick={onCompleteCheckout} className="flex-1 rounded-full bg-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.08)]">
                      I completed payment
                    </button>
                  </div>
                  <div className="mt-5 rounded-[22px] border border-slate-200/60 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Recent receipts</div>
                    <div className="mt-3 space-y-3">
                      {recentReceipts.slice(0, 3).map((item) => (
                        <div key={item.id} className="rounded-[18px] border border-slate-200/60 bg-slate-50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-slate-900">{item.receiptNumber}</div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-500">{capitalize(item.status)}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.apiName} · {formatCurrency(item.amountCents, item.currency)}
                          </div>
                        </div>
                      ))}
                      {!recentReceipts.length && <div className="text-sm text-slate-500">No receipts yet.</div>}
                    </div>
                  </div>
                  <textarea readOnly value={receiptCopy} className="mt-4 h-28 w-full rounded-[18px] border border-slate-200/60 bg-white p-4 text-xs text-slate-600 outline-none" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoinModal({
  api,
  reason,
  balance,
  onClose,
  onSpend,
}: {
  api: ApiDefinition;
  reason: "tier" | "rate";
  balance: number;
  onClose: () => void;
  onSpend: () => void;
}) {
  const title = reason === "tier" ? "Use your Magnexis API Coin to unlock this API" : "Use your Magnexis API Coin to bypass the rate limit once";
  return (
    <div className="fixed inset-0 z-[65] grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[32px] border border-slate-200/60 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
        <div className="bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-6 md:p-8">
          <div className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-500 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">Magnexis API Coin</div>
          <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{title}</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            You have <span className="font-semibold text-slate-900">{balance}</span> coin left. Spending it allows one execution of <span className="font-semibold text-slate-900">{api.name}</span> even if your tier or rate limit would block it.
          </p>
          <div className="mt-5 rounded-[24px] border border-blue-100/70 bg-white p-4 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">API coin rules</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>• Each account starts with one coin.</li>
              <li>• Coins are non-refundable and limited to one per person.</li>
              <li>• Coins can unlock one protected or rate-limited execution.</li>
            </ul>
          </div>
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-full border border-slate-200/70 bg-white px-4 py-3 text-sm">
              Cancel
            </button>
            <button type="button" onClick={onSpend} className="flex-1 rounded-full bg-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.08)]">
              Spend 1 coin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignupScreen({
  draft,
  onChange,
  onContinue,
}: {
  draft: { displayName: string; email: string };
  onChange: (value: { displayName: string; email: string }) => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-slate-200/60 bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.14)] md:p-8">
        <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-500">Create your Magnexis account</div>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Sign up to claim your one API coin</h2>
        <p className="mt-2 text-sm text-slate-500">This account is local to your browser workspace and unlocks onboarding, saved state, and one Magnexis API Coin.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field
            label="Display name"
            value={draft.displayName}
            onChange={(value) => onChange({ ...draft, displayName: value })}
            placeholder="Magnexis Explorer"
          />
          <Field
            label="Email"
            value={draft.email}
            onChange={(value) => onChange({ ...draft, email: value })}
            placeholder="you@example.com"
          />
        </div>
        <div className="mt-4 rounded-[24px] border border-slate-200/60 bg-slate-50 p-4 text-sm text-slate-600">
          Your account starts with <span className="font-semibold text-slate-900">1 API Coin</span>. You can spend it to unlock one premium or rate-limited API execution.
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onContinue}
            disabled={!draft.email.trim()}
            className="rounded-full bg-blue-400 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingScreen({
  selected,
  onToggle,
  onContinue,
}: {
  selected: string[];
  onToggle: (interest: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-slate-200/60 bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
        <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-500">Welcome to Magnexis APIHub</div>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Choose your interests</h2>
        <p className="mt-2 text-sm text-slate-500">We will recommend API packs, starter collections, and coin guidance based on what you want to build.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {ALL_INTERESTS.map((interest) => (
            <button
              type="button"
              key={interest}
              onClick={() => onToggle(interest)}
            className={`rounded-full border px-4 py-2 text-sm ${selected.includes(interest) ? "border-blue-100/80 bg-blue-50 text-blue-500 shadow-[0_2px_6px_rgba(66,133,244,0.08)]" : "border-slate-200/70 bg-white text-slate-600"}`}
            >
              {interest}
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onContinue} className="rounded-full bg-blue-400 px-5 py-3 text-sm font-medium text-white">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[32px] border border-slate-200/60 bg-white/95 p-6 shadow-[0_8px_22px_rgba(15,23,42,0.045)] backdrop-blur">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h3 className="text-[22px] font-semibold tracking-tight text-slate-900">{title}</h3>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[28px] border border-slate-200/60 bg-white p-6 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{note}</div>
    </div>
  );
}

function CompactApiRow({ api }: { api: ApiDefinition }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/60 bg-slate-50/80 px-4 py-3">
      <div>
        <div className="font-medium text-slate-900">{api.name}</div>
        <div className="text-xs text-slate-500">{api.endpoint}</div>
      </div>
      <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">{api.method}</span>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-slate-300/70 bg-slate-50/80 p-8 text-center">
      <div className="text-base font-semibold tracking-tight text-slate-900">{title}</div>
      <div className="mt-2 text-sm text-slate-500">{description}</div>
    </div>
  );
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SearchItem({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-[18px] border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-left shadow-none transition hover:border-blue-100 hover:bg-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.05)]">
      <div className="font-medium text-slate-900">{title}</div>
      <div className="text-xs text-slate-500">{subtitle}</div>
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: any) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm outline-none">
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <input value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-100 focus:bg-white focus:shadow-[0_0_0_3px_rgba(66,133,244,0.07)]" />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm transition hover:bg-white">
      <span>{label}</span>
      <span className={`inline-flex h-6 w-11 items-center rounded-full p-1 ${checked ? "bg-blue-400" : "bg-slate-300"}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-slate-200/60 bg-white p-6 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
      <h3 className="text-base font-semibold tracking-tight text-slate-900">{title}</h3>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Editor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-[22px] border border-slate-200/70 bg-slate-50 p-4">
      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-36 w-full rounded-xl border border-slate-200/70 bg-white p-3 font-mono text-xs text-slate-700 outline-none transition focus:border-blue-100 focus:shadow-[0_0_0_3px_rgba(66,133,244,0.07)]" />
    </label>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className={`mt-2 text-sm leading-6 text-slate-700 ${mono ? "font-mono whitespace-pre-wrap" : ""}`}>{value}</div>
    </div>
  );
}

function ErrorRow({ code, message }: { code: string; message: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-rose-500">{code}</div>
      <div className="mt-2 text-sm text-slate-700">{message}</div>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">{label}</span>;
}

function NavButton({ active, label, description, onClick }: { active: boolean; label: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-[20px] px-4 py-3 text-left transition ${active ? "bg-blue-50 text-blue-500 shadow-[0_4px_10px_rgba(66,133,244,0.05)]" : "hover:bg-slate-50/80"}`}>
      <div className="font-medium">{label}</div>
      <div className="text-xs text-slate-500">{description}</div>
    </button>
  );
}

function methodBadge(method: string) {
  return method === "GET" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-500";
}

function packBadge(color: string) {
  switch (color) {
    case "green":
      return "bg-emerald-50 text-emerald-600";
    case "amber":
      return "bg-amber-50 text-amber-600";
    case "violet":
      return "bg-violet-50 text-violet-600";
    case "rose":
      return "bg-rose-50 text-rose-600";
    default:
      return "bg-blue-50 text-blue-500";
  }
}

function collectionThemeBadge(color: string) {
  switch (color) {
    case "green":
      return "bg-emerald-400";
    case "amber":
      return "bg-amber-300";
    case "violet":
      return "bg-violet-400";
    case "rose":
      return "bg-rose-400";
    default:
      return "bg-blue-400";
  }
}

function categoryIconClass(category: string) {
  const palette: Record<string, string> = {
    ai: "bg-blue-50 text-blue-500",
    text: "bg-emerald-50 text-emerald-600",
    dev: "bg-slate-100 text-slate-700",
    data: "bg-cyan-50 text-cyan-600",
    business: "bg-amber-50 text-amber-600",
    finance: "bg-teal-50 text-teal-600",
    security: "bg-rose-50 text-rose-600",
    web: "bg-violet-50 text-violet-600",
    media: "bg-pink-50 text-pink-600",
    game: "bg-orange-50 text-orange-600",
    sim: "bg-sky-50 text-sky-600",
    edu: "bg-lime-50 text-lime-600",
    utility: "bg-indigo-50 text-indigo-600",
  };
  return palette[category] ?? "bg-slate-100 text-slate-700";
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Magnexis APIHub UI error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-items-center bg-[var(--app-bg)] px-6 text-slate-900">
          <div className="w-full max-w-2xl rounded-[28px] border border-slate-200/60 bg-white p-8 shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
            <div className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600">Recovered from a UI error</div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Magnexis APIHub hit a render problem</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              The app caught an unexpected UI error and stopped the blank-screen crash from taking over the whole window.
            </p>
            {this.state.message && <pre className="mt-4 overflow-auto rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">{this.state.message}</pre>}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: "" });
                  window.location.reload();
                }}
                className="rounded-full bg-blue-400 px-5 py-3 text-sm font-medium text-white shadow-[0_6px_14px_rgba(66,133,244,0.08)]"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}

function buildWorkflowDraft(workflow: { steps: Array<string | { apiId: string; inputMap?: string; outputMap?: string }> } | null): WorkflowStep[] {
  if (!workflow) {
    return [];
  }
  return workflow.steps.slice(0, 4).map((step) => ({
    apiId: workflowStepId(step),
    inputMap: typeof step === "string" ? "" : step.inputMap ?? "",
    outputMap: typeof step === "string" ? "" : step.outputMap ?? "",
    status: "idle",
    result: "",
  }));
}

function buildSnippet(api: ApiDefinition | null, body: string): string {
  if (!api) {
    return "Select an API to generate a snippet.";
  }
  const baseUrl = getApiBaseUrl();
  return [
    "import requests",
    "",
    `response = requests.${api.method.toLowerCase()}("${baseUrl}${api.endpoint}", json=${body || "{}"})`,
    "print(response.json())",
  ].join("\n");
}

function buildSearchResults(query: string, catalog: ApiDefinition[], collections: any[], workflows: any[], categories: Category[]): SearchResult {
  const q = query.toLowerCase();
  return {
    apis: catalog.filter((item) => [item.name, item.endpoint, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(q)).slice(0, 8),
    categories: categories.filter((item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)).slice(0, 8),
    collections: collections.filter((item) => [item.name, item.description, item.id].join(" ").toLowerCase().includes(q)).slice(0, 8),
    workflows: workflows.filter((item) => [item.name, item.description, item.id].join(" ").toLowerCase().includes(q)).slice(0, 8),
  };
}

function deriveStats(
  stats: Record<string, unknown>,
  account: Account | null,
  favorites: string[],
  collections: any[],
  workflows: any[],
  history: ExecutionResult[],
): Array<{ label: string; value: string; note: string }> {
  const averageLatency = (stats.averageLatencyMs as number | undefined) ?? history.reduce((sum, item) => sum + item.latencyMs, 0) / Math.max(1, history.length);
  return [
    { label: "Total APIs", value: String(stats.totalApis ?? "700+"), note: "Registered Magnexis endpoints" },
    { label: "APIs Tested Today", value: String(Math.max(1, history.length)), note: "Local execution history" },
    { label: "API Coin", value: String(account?.apiCoinBalance ?? 0), note: account?.signedUp ? "One per account" : "Sign up to claim one" },
    { label: "Saved Collections", value: String(collections.length), note: "Reusable folders" },
    { label: "Workflow Runs", value: String(workflows.length), note: "Saved pipelines" },
    { label: "Average Latency", value: `${Math.round(averageLatency || 0)} ms`, note: "Fast local execution" },
  ];
}

function sortApis(items: ApiDefinition[], sort: SortMode): ApiDefinition[] {
  const list = [...items];
  switch (sort) {
    case "a-z":
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case "newest":
      return list.sort((a, b) => b.id.localeCompare(a.id));
    case "fastest":
      return list.sort((a, b) => complexityWeight(a.complexity) - complexityWeight(b.complexity));
    case "recent":
      return list.sort((a, b) => Number(b.polished) - Number(a.polished));
    case "popular":
    default:
      return list.sort((a, b) => Number(b.polished) - Number(a.polished) || a.name.localeCompare(b.name));
  }
}

function complexityWeight(complexity: string): number {
  return complexity === "low" ? 1 : complexity === "medium" ? 2 : 3;
}

function safeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseRoute(hash: string): AppRoute {
  const cleaned = hash.replace(/^#\/?/, "").replace(/^\/+/, "");
  const parts = cleaned ? cleaned.split("/").filter(Boolean) : [];
  const view = (parts[0] as AppView | "search" | undefined) ?? "dashboard";
  if (!["dashboard", "catalog", "playground", "collections", "workflows", "settings", "search"].includes(view)) {
    return { view: "dashboard" };
  }
  if (view === "search") {
    return { view: "catalog", search: decodeURIComponent(parts.slice(1).join("/")) };
  }
  if (view === "catalog") {
    const apiId = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    const tab = isApiTab(parts[2]) ? (parts[2] as ApiTab) : undefined;
    return {
      view,
      apiId,
      tab,
      requestId: tab === "history" && parts[3] ? decodeURIComponent(parts[3]) : undefined,
    };
  }
  if (view === "playground") {
    return {
      view,
      apiId: parts[1] ? decodeURIComponent(parts[1]) : undefined,
    };
  }
  if (view === "collections") {
    return { view, collectionId: parts[1] ? decodeURIComponent(parts[1]) : undefined };
  }
  if (view === "workflows") {
    return { view, workflowId: parts[1] ? decodeURIComponent(parts[1]) : undefined };
  }
  return { view };
}

function buildHash(route: AppRoute): string {
  if (route.search !== undefined) {
    return `#/search/${encodeURIComponent(route.search)}`;
  }
  if (route.view === "catalog") {
    const tab = route.tab ? `/${route.tab}` : "";
    const api = route.apiId ? `/${encodeURIComponent(route.apiId)}` : "";
    const request = route.requestId ? `/${encodeURIComponent(route.requestId)}` : "";
    return `#/catalog${api}${tab}${request}`;
  }
  if (route.view === "playground") {
    const api = route.apiId ? `/${encodeURIComponent(route.apiId)}` : "";
    return `#/playground${api}`;
  }
  if (route.view === "collections") {
    return route.collectionId ? `#/collections/${encodeURIComponent(route.collectionId)}` : "#/collections";
  }
  if (route.view === "workflows") {
    return route.workflowId ? `#/workflows/${encodeURIComponent(route.workflowId)}` : "#/workflows";
  }
  return `#/${route.view}`;
}

function isApiTab(value: string | undefined): value is ApiTab {
  return !!value && ["overview", "request", "response", "examples", "errors", "code", "history"].includes(value);
}

function loadStoredSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readLocalJson<Partial<Settings>>("magnexis-settings") };
}

function loadStoredResults(): SavedResult[] {
  const results = readLocalJson<unknown>("magnexis-saved-results");
  return Array.isArray(results) ? (results as SavedResult[]) : [];
}

function persistLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function readLocalJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function readJsonFile(file: File): Promise<any> {
  const text = await file.text();
  return JSON.parse(text);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCurrency(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function tierRank(tier: Settings["subscription_tier"]): number {
  return TIER_ORDER[tier];
}

function tierLabel(tier: Settings["subscription_tier"] | ApiDefinition["requiredTier"]): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function maxTier(a: Settings["subscription_tier"], b: Settings["subscription_tier"]): Settings["subscription_tier"] {
  return tierRank(a) >= tierRank(b) ? a : b;
}

function canAccessApi(api: ApiDefinition, currentTier: Settings["subscription_tier"]): boolean {
  return tierRank(currentTier) >= tierRank(api.requiredTier);
}

function workflowStepId(step: string | { apiId: string }): string {
  return typeof step === "string" ? step : step.apiId;
}

function apiLabelFromId(apiId?: string): string {
  if (!apiId) {
    return "API";
  }
  const parts = apiId.split(".");
  const slug = parts[1] ?? parts[0] ?? apiId;
  return slug.replaceAll("-", " ");
}

function openExternalUrl(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.assign(url);
  }
}

async function waitForBackendReady(attempts = 24, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await loadHealth();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const NAV_ITEMS: Array<{ id: AppView; label: string; description: string }> = [
  { id: "dashboard", label: "Dashboard", description: "Welcome and recommendations" },
  { id: "catalog", label: "API Catalog", description: "Search and explore APIs" },
  { id: "playground", label: "Playground 2.0", description: "Build and inspect requests" },
  { id: "collections", label: "Collections", description: "Saved API folders" },
  { id: "workflows", label: "Workflows", description: "Chained API pipelines" },
  { id: "settings", label: "Settings", description: "Appearance and local server" },
];

export default App;
