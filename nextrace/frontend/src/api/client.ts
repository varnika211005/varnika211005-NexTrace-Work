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
  uploadDataset: async (datasetType: string, file: File, mode: "append" | "replace" = "append") => {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    return request<any>(`/admin/ingestion/upload/${datasetType}`, { method: "POST", body: form });
  },
  deleteDataset: (datasetType: string) => del<any>(`/admin/ingestion/${datasetType}`),

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
  deleteEntity: (id: string) => del<any>(`/admin/entities/${id}`),

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
  // ---- Evidence integrity (SHA-256) ----
  verifyEvidence: (type: string, id: string) => post<any>(`/evidence/${type}/${id}/verify`),
  sealEvidence: () => post<any>("/admin/evidence/seal"),
  listBiometric: () => get<any[]>("/evidence/biometric"),
  registerBiometric: (body: any) => post<any>("/admin/evidence/biometric/register", body),
  biometricMatch: (bid: number) => post<any>(`/evidence/biometric/${bid}/match`),

  // ---- Cases ----
  listCases: () => get<any[]>("/cases"),
  getCase: (caseId: string) => get<any>(`/cases/${caseId}`),
  changeCaseStatus: (caseId: string, newStatus: string, comment?: string) =>
    post<any>(`/cases/${caseId}/status`, { new_status: newStatus, comment: comment || "" }),

  // ---- Reports ----
  // The backend now generates the PDF entirely in memory and streams it back in one call -
  // nothing is written to disk server-side, so there's no separate "download" step or filename
  // to track afterward.
  generateReport: async (body: { case_id?: string; person_id?: string; sections?: string[] }) => {
    const token = getToken();
    const res = await fetch(`${BASE}/reports/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.detail || detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, res.status);
    }
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `NexTrace_Report_${Date.now()}.pdf`;
    const blob = await res.blob();
    return { blob, filename };
  },

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
  updateUser: (analystId: string, updates: { name?: string; role?: string; new_password?: string }) =>
    request<any>(`/admin/users/${analystId}`, { method: "PATCH", body: JSON.stringify(updates) }),
  deleteUser: (analystId: string) => del<any>(`/admin/users/${analystId}`),

  // ---- Admin: Access control ----
  listAccess: () => get<any[]>("/admin/access-control"),
  assignAccess: (body: { case_id: string; analyst_id: string; access_level: string }) =>
    post<any>("/admin/access-control", body),
  removeAccess: (id: number) => del<any>(`/admin/access-control/${id}`),

  // ---- Case messaging (shared discussion thread per case) ----
  listCaseMessages: (caseId: string) => get<any[]>(`/cases/${caseId}/messages`),
  postCaseMessage: (caseId: string, message: string) =>
    post<any>(`/cases/${caseId}/messages`, { message }),

  // ---- Access requests ----
  listAccessRequests: () => get<any[]>("/access-requests"),
  createAccessRequest: (body: { request_type: "case" | "person"; target_id: string; reason: string }) =>
    post<any>("/access-requests", body),
  approveAccessRequest: (id: number, admin_note?: string) =>
    post<any>(`/admin/access-requests/${id}/approve`, { admin_note }),
  denyAccessRequest: (id: number, admin_note?: string) =>
    post<any>(`/admin/access-requests/${id}/deny`, { admin_note }),

  // ---- Admin: Security ----
  security: () => get<any>("/admin/security"),
  securityEvents: (status?: string) =>
    get<any[]>(`/admin/security/events${status ? `?status=${status}` : ""}`),
  ackSecurityEvent: (id: number) => post<any>(`/admin/security/events/${id}/ack`),
  simulateTamper: (body: { evidence_type: string; record_id: string; field_name: string; tampered_value: string }) =>
    post<any>("/admin/security/simulate-tamper", body),
  restoreTamperedEvidence: (body: { evidence_type: string; record_id: string }) =>
    post<any>("/admin/security/restore-tampered-evidence", body),
  tamperRecords: () => get<any[]>("/admin/security/tamper-records"),

  // ---- Admin: Immutable ledger ----
  ledger: () => get<any>("/admin/ledger"),
  verifyLedger: () => post<any>("/admin/ledger/verify"),

  // ---- Admin: Backup & Restore ----
  createBackup: () => post<any>("/admin/backup"),
  listBackups: () => get<any[]>("/admin/backup"),
  downloadBackup: async (id: number) => {
    const token = getToken();
    const res = await fetch(`${BASE}/admin/backup/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.detail || detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, res.status);
    }
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const blob = await res.blob();
    return { blob, filename: match ? match[1] : `nextrace_backup_${id}.json.gz` };
  },

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