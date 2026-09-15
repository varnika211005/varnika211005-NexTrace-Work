const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("nextrace_token");
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("nextrace_token");
    localStorage.removeItem("nextrace_user");
    window.location.href = "/login";
    throw new ApiError("Session expired", 401);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json();
  }
  return res as unknown as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: any) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  // ---- Auth ----
  login: (analyst_id: string, password: string) =>
    post<{ token: string; user: { analyst_id: string; name: string; role: string } }>("/auth/login", { analyst_id, password }),
  me: () => get<any>("/auth/me"),

  // ---- Dashboard ----
  dashboard: () => get<any>("/dashboard"),

  // ---- Ingestion (admin) ----
  ingestionFiles: () => get<any[]>("/admin/ingestion/files"),
  uploadDataset: async (datasetType: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<any>(`/admin/ingestion/upload/${datasetType}`, { method: "POST", body: form });
  },

  // ---- Processing (admin) ----
  startProcessing: () => post<{ job_id: number; message: string }>("/admin/processing/start"),
  getJob: (id: number) => get<any>(`/admin/processing/jobs/${id}`),
  listJobs: () => get<any[]>("/admin/processing/jobs"),

  // ---- Entity Resolution ----
  listResolutionCandidates: () => get<any[]>("/entity-resolution"),
  confirmMatch: (id: number) => post<any>(`/admin/entity-resolution/${id}/confirm`),
  rejectMatch: (id: number) => post<any>(`/admin/entity-resolution/${id}/reject`),

  // ---- Entities ----
  listEntities: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get<any[]>(`/entities${qs ? `?${qs}` : ""}`);
  },
  getEntity: (id: string) => get<any>(`/entities/${id}`),

  // ---- Graph ----
  getGraph: (minConfidence = 0, categories?: string[]) => {
    const params = new URLSearchParams({ min_confidence: String(minConfidence) });
    if (categories && categories.length) params.set("categories", categories.join(","));
    return get<any>(`/graph?${params.toString()}`);
  },
  graphAnalytics: () => get<any>("/graph/analytics"),
  shortestPath: (source_id: string, target_id: string) => post<any>("/graph/path", { source_id, target_id }),

  // ---- Timeline ----
  timeline: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get<any[]>(`/timeline${qs ? `?${qs}` : ""}`);
  },

  // ---- Evidence ----
  evidenceList: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get<any[]>(`/evidence${qs ? `?${qs}` : ""}`);
  },
  evidenceDetail: (type: string, id: string) => get<any>(`/evidence/${type}/${id}`),

  // ---- Cases ----
  listCases: () => get<any[]>("/cases"),
  getCase: (caseId: string) => get<any>(`/cases/${caseId}`),

  // ---- Reports ----
  generateReport: (body: { case_id?: string; person_id?: string; sections?: string[] }) =>
    post<{ filename: string; download_url: string }>("/reports/generate", body),
  downloadReportUrl: (filename: string) => `${BASE}/reports/download/${filename}`,

  // ---- Admin: Audit ----
  auditLog: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get<any[]>(`/admin/audit${qs ? `?${qs}` : ""}`);
  },

  // ---- Admin: Users ----
  listUsers: () => get<any[]>("/admin/users"),
  createUser: (body: { analyst_id: string; name: string; password: string; role: string }) =>
    post<any>("/admin/users", body),
  toggleUser: (analystId: string) => post<any>(`/admin/users/${analystId}/deactivate`),

  // ---- Admin: Access control ----
  listAccess: () => get<any[]>("/admin/access-control"),
  assignAccess: (body: { case_id: string; analyst_id: string; access_level: string }) =>
    post<any>("/admin/access-control", body),
  removeAccess: (id: number) => del<any>(`/admin/access-control/${id}`),

  // ---- Admin: Security ----
  security: () => get<any>("/admin/security"),

  // ---- Admin: Reset ----
  resetAll: () => post<any>("/admin/reset"),
};

export function getStoredUser(): { analyst_id: string; name: string; role: string } | null {
  const raw = localStorage.getItem("nextrace_user");
  return raw ? JSON.parse(raw) : null;
}

export function storeAuth(token: string, user: { analyst_id: string; name: string; role: string }) {
  localStorage.setItem("nextrace_token", token);
  localStorage.setItem("nextrace_user", JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem("nextrace_token");
  localStorage.removeItem("nextrace_user");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}
