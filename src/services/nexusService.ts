/**
 * Nexus application lifecycle service connected to live FastAPI backend.
 */

import { api } from "@/api/client";
import type { IndexedFolder } from "@/types";

const CONFIGURED_FOLDERS_KEY = "nexus_configured_folders";

export function getConfiguredFolders(): string[] {
  try {
    const raw = localStorage.getItem(CONFIGURED_FOLDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error("Failed to read configured folders:", err);
  }
  return [];
}

export function saveConfiguredFolders(folders: string[]): void {
  try {
    localStorage.setItem(CONFIGURED_FOLDERS_KEY, JSON.stringify(folders));
  } catch (err) {
    console.error("Failed to save configured folders:", err);
  }
}

export function addConfiguredFolder(folderPath: string): string[] {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const current = getConfiguredFolders();
  if (!current.includes(normalized)) {
    const updated = [...current, normalized];
    saveConfiguredFolders(updated);
    return updated;
  }
  return current;
}

export function removeConfiguredFolder(folderPath: string): string[] {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const current = getConfiguredFolders();
  const updated = current.filter((p) => p !== normalized);
  saveConfiguredFolders(updated);
  try {
    const rawCounts = localStorage.getItem("nexus_folder_counts");
    if (rawCounts) {
      const counts = JSON.parse(rawCounts);
      delete counts[normalized];
      localStorage.setItem("nexus_folder_counts", JSON.stringify(counts));
    }
  } catch {}
  return updated;
}

export async function initializeSearchEngine(): Promise<void> {
  try {
    await api.health();
  } catch (err) {
    console.warn("Backend health check failed on boot:", err);
  }
}

export async function loadIndexedFiles(): Promise<IndexedFolder[]> {
  try {
    const configured = getConfiguredFolders();
    const cachedCounts = (() => {
      try {
        return JSON.parse(localStorage.getItem("nexus_folder_counts") || "{}");
      } catch {
        return {};
      }
    })();

    let files: any[] = [];
    try {
      files = await api.listFiles(500, 0, "indexed");
    } catch {
      // Backend might still be starting up, return configured folders with cached counts
      return configured.map((folderPath) => {
        const normFolderPath = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
        return {
          id: `folder-${normFolderPath}`,
          path: normFolderPath,
          fileCount: cachedCounts[normFolderPath] ?? 0,
        };
      });
    }

    const updatedCounts: Record<string, number> = { ...cachedCounts };
    const folders: IndexedFolder[] = configured.map((folderPath) => {
      const normFolderPath = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
      const count = files.filter((file) => {
        const normFilePath = file.path.replace(/\\/g, "/");
        return normFilePath.startsWith(normFolderPath + "/") || normFilePath === normFolderPath;
      }).length;

      updatedCounts[normFolderPath] = count;

      return {
        id: `folder-${normFolderPath}`,
        path: normFolderPath,
        fileCount: count,
      };
    });

    try {
      localStorage.setItem("nexus_folder_counts", JSON.stringify(updatedCounts));
    } catch {}

    return folders;
  } catch (err) {
    console.error("Failed to load indexed files:", err);
    return [];
  }
}

export async function loadRecentSearches(): Promise<string[]> {
  const saved = localStorage.getItem("nexus_recent_searches");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // ignore
    }
  }
  return [
    "machine learning architecture",
    "project architecture",
    "vector store indexing",
    "python embeddings",
  ];
}

export async function initializeNexus(): Promise<{ recentSearches: string[]; folders: IndexedFolder[] }> {
  await initializeSearchEngine();
  const [recentSearches, folders] = await Promise.all([
    loadRecentSearches(),
    loadIndexedFiles(),
  ]);
  return { recentSearches, folders };
}

export const launchNexus = initializeNexus;
