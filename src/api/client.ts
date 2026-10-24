import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  FileRecord,
  HealthResponse,
  IndexDirectoryResponse,
  IndexResponse,
  ProviderConfig,
  SearchResponse,
  SettingsInfoResponse,
  StatsResponse,
} from "../types";

let cachedPort: number | null = null;

// Check if running inside Tauri environment
const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

if (isTauri) {
  // Listen for backend-ready event from Tauri Rust sidecar launcher
  listen<number>("backend-ready", (event) => {
    if (event.payload && typeof event.payload === "number") {
      console.log("[Client] Backend ready on port:", event.payload);
      cachedPort = event.payload;
    }
  }).catch((err) => {
    console.warn("[Client] Failed to register backend-ready listener:", err);
  });
}

/**
 * Resolves the active backend port with retry/polling in Tauri.
 * Ensures we never get permanently stuck on a dead port.
 */
async function resolvePort(): Promise<number> {
  if (cachedPort && cachedPort !== 8000) {
    return cachedPort;
  }

  if (!isTauri) {
    cachedPort = 8000;
    return 8000;
  }

  // Poll Rust get_backend_port up to 40 times (10 seconds total)
  for (let i = 0; i < 40; i++) {
    try {
      const port = await invoke<number | null>("get_backend_port");
      if (port && port > 0) {
        cachedPort = port;
        return port;
      }
    } catch (err) {
      console.warn("[Client] get_backend_port error:", err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (cachedPort) {
    return cachedPort;
  }

  console.warn("[Client] Could not resolve sidecar port after retries, falling back to 8000");
  return 8000;
}

export async function getBaseUrl(): Promise<string> {
  const port = await resolvePort();
  return `http://127.0.0.1:${port}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = await getBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (networkErr: any) {
    console.warn(`[Client] Request to ${baseUrl}${path} failed:`, networkErr);
    // Invalidate cached port if the connection refused or dropped
    cachedPort = null;
    throw new Error(
      networkErr?.message?.includes("Load failed")
        ? "Could not connect to Nexus backend. The local service might still be starting."
        : (networkErr?.message || "Network request failed")
    );
  }

  if (!response.ok) {
    let errorDetail = `Request to ${path} failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errorDetail);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  getSettings: () => request<SettingsInfoResponse>("/settings"),

  saveSettings: (config: ProviderConfig) =>
    request<{ provider: string; saved: boolean }>("/settings", {
      method: "POST",
      body: JSON.stringify({ provider: config.provider, api_key: config.apiKey }),
    }),

  search: (query: string, topK = 10) =>
    request<SearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK }),
    }),

  indexFile: (filePath: string) =>
    request<IndexResponse>("/index", {
      method: "POST",
      body: JSON.stringify({ file_path: filePath }),
    }),

  indexDirectory: (directoryPath: string) =>
    request<IndexDirectoryResponse>("/index-directory", {
      method: "POST",
      body: JSON.stringify({ directory_path: directoryPath }),
    }),

  listFiles: (limit = 100, offset = 0, status?: string) => {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (status) params.append("status", status);
    return request<FileRecord[]>(`/files?${params.toString()}`);
  },

  deleteFile: (fileId: number) =>
    request<{ deleted: boolean; file_id: number; path: string }>(`/files/${fileId}`, {
      method: "DELETE",
    }),

  deleteFolder: (folderPath: string) =>
    request<{ deleted_files: number; folder: string }>(`/folders?path=${encodeURIComponent(folderPath)}`, {
      method: "DELETE",
    }),

  clearAll: () =>
    request<{ cleared: boolean }>("/clear", {
      method: "POST",
    }),

  getStats: () => request<StatsResponse>("/stats"),
};
