import { AnimatePresence, motion } from "motion/react";
import { History, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BootSequence } from "@/components/BootSequence";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { SearchLoadingState } from "@/components/SearchLoadingState";
import { EmptyState } from "@/components/EmptyState";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IndexingStatusBadge } from "@/components/IndexingStatusBadge";
import { RecentSearches } from "@/components/RecentSearches";
import { SearchEyes, type SearchEyeState } from "@/components/SearchEyes";
import { SemanticFileGraph } from "@/components/SemanticFileGraph";
import type { SearchPhase } from "@/components/SemanticSearchAnimation";
import { searchFiles, getSavedProvider, getSavedApiKey } from "@/services/searchService";
import { initializeNexus, loadIndexedFiles, addConfiguredFolder, removeConfiguredFolder, getConfiguredFolders } from "@/services/nexusService";
import { api } from "@/api/client";
import { open, message, confirm } from "@tauri-apps/plugin-dialog";
import type { FileResult, IndexedFolder, IndexingStatus } from "@/types";

// Quick, responsive boot overlay
const BOOT_MIN_MS = 600;

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [booting, setBooting] = useState(true);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [folders, setFolders] = useState<IndexedFolder[]>(() => {
    try {
      const configured = getConfiguredFolders();
      const cachedCounts = JSON.parse(localStorage.getItem("nexus_folder_counts") || "{}");
      return configured.map((p) => {
        const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
        return {
          id: `folder-${norm}`,
          path: norm,
          fileCount: cachedCounts[norm] ?? 0,
        };
      });
    } catch {
      return [];
    }
  });
  const [indexingFolderId, setIndexingFolderId] = useState<string | null>(null);
  const [indexing, setIndexing] = useState<IndexingStatus>(() => {
    try {
      const saved = localStorage.getItem("nexus_last_stats");
      if (saved) {
        const stats = JSON.parse(saved);
        return {
          processed: stats.indexed_files ?? 0,
          total: stats.total_files || stats.indexed_files || 0,
          currentFolder: stats.active_provider ? `Provider: ${stats.active_provider.toUpperCase()}` : "Ready",
          done: true,
        };
      }
    } catch {}
    return {
      processed: 0,
      total: 0,
      currentFolder: "",
      done: true,
    };
  });

  // Boot: run backend health check & load initial state in parallel with visual boot sequence
  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    initializeNexus().then(({ recentSearches, folders: loadedFolders }) => {
      if (cancelled) return;
      setRecentSearches(recentSearches);
      setFolders(loadedFolders);

      // Auto-sync saved API key to backend if available
      const savedProvider = getSavedProvider();
      const savedKey = getSavedApiKey(savedProvider);
      if (savedKey) {
        api.health()
          .then((h) => {
            if (!h.provider_configured || h.active_provider !== savedProvider) {
              return api.saveSettings({ provider: savedProvider, apiKey: savedKey });
            }
          })
          .catch(() => {});
      }

      // Fetch live indexing stats
      api.getStats().then((stats) => {
        if (!cancelled && stats) {
          try {
            localStorage.setItem("nexus_last_stats", JSON.stringify(stats));
          } catch {}
          setIndexing({
            processed: stats.indexed_files,
            total: stats.total_files || stats.indexed_files,
            currentFolder: stats.active_provider ? `Provider: ${stats.active_provider.toUpperCase()}` : "Ready",
            done: true,
          });
        }
      }).catch(() => {});

      const remaining = Math.max(0, BOOT_MIN_MS - (Date.now() - started));
      setTimeout(() => {
        if (!cancelled) {
          setBooting(false);
          inputRef.current?.focus();
        }
      }, remaining);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh folders list
  const refreshFolders = async () => {
    const loaded = await loadIndexedFiles();
    setFolders(loaded);
    const stats = await api.getStats().catch(() => null);
    if (stats) {
      try {
        localStorage.setItem("nexus_last_stats", JSON.stringify(stats));
      } catch {}
      setIndexing({
        processed: stats.indexed_files,
        total: stats.total_files || stats.indexed_files,
        currentFolder: stats.active_provider ? `Provider: ${stats.active_provider.toUpperCase()}` : "Ready",
        done: true,
      });
    }
  };

  // Debounced semantic search connected to live FastAPI backend
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      let res: FileResult[];
      try {
        res = await searchFiles(q);
      } catch {
        if (!cancelled) {
          setSearchError(true);
          setResults([]);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setSearchError(false);
        setResults(res);
        setLoading(false);
        setRecentSearches((prev) => {
          const next = [q, ...prev.filter((p) => p !== q)].slice(0, 8);
          localStorage.setItem("nexus_recent_searches", JSON.stringify(next));
          return next;
        });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // Keyboard shortcuts (Cmd+K / Ctrl+K & Escape)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setHistoryOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const phase: SearchPhase = loading
    ? "searching"
    : results
      ? "results"
      : query
        ? "typing"
        : focused
          ? "focused"
          : "idle";

  const found = results ? results.length > 0 : null;
  const [eyes, setEyes] = useState<SearchEyeState>("idle");
  useEffect(() => {
    if (loading) return setEyes("searching");
    if (!results) return setEyes("idle");
    const next: SearchEyeState = searchError ? "error" : found ? "found" : "no-results";
    setEyes(next);
    const t = setTimeout(() => setEyes("idle"), next === "found" ? 1800 : 2200);
    return () => clearTimeout(t);
  }, [loading, results, found, searchError]);

  return (
    <main className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      {/* Boot overlay — rendered above everything, exits via AnimatePresence */}
      <AnimatePresence>
        {booting && <BootSequence key="boot" />}
      </AnimatePresence>

      <SemanticFileGraph phase={phase} found={found} />

      <header className="relative z-10 flex items-center justify-end gap-1 px-5 py-4">
        <motion.button
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.1 }}
          onClick={() => setHistoryOpen((o) => !o)}
          aria-label="Toggle recent searches"
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            historyOpen
              ? "border-border bg-surface text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:bg-surface hover:text-foreground"
          }`}
        >
          <History className="h-[17px] w-[17px]" />
        </motion.button>
        <ThemeToggle />
        <motion.button
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.1 }}
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-surface hover:text-foreground"
        >
          <Settings className="h-[17px] w-[17px]" />
        </motion.button>
      </header>

      <RecentSearches
        open={historyOpen}
        searches={recentSearches}
        onSelect={(q) => {
          setQuery(q);
          setHistoryOpen(false);
          inputRef.current?.focus();
        }}
        onClear={() => {
          setRecentSearches([]);
          localStorage.removeItem("nexus_recent_searches");
        }}
        onClose={() => setHistoryOpen(false)}
      />

      <div className="relative z-10 flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pb-[30vh]">
        <div className="flex w-full max-w-[640px] flex-col pt-[8vh]">
          <motion.p
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
            className="mb-6 text-center text-[13px] font-medium tracking-[0.35em] text-muted-foreground"
          >
            NEXUS
          </motion.p>

          {!booting && (
            <>
              <div className="mb-5">
                <SearchEyes state={eyes} />
              </div>
              <motion.div
                initial={{ scaleX: 0.25, opacity: 0, y: -10 }}
                animate={{ scaleX: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 170, damping: 22, delay: 0.1 }}
              >
                <SearchBar
                  ref={inputRef}
                  value={query}
                  onChange={setQuery}
                  onSubmit={() => inputRef.current?.blur()}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  focused={focused}
                />
              </motion.div>

              <div className="mt-6">
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.div key="loading" exit={{ opacity: 0 }}>
                      <SearchLoadingState />
                    </motion.div>
                  ) : results ? (
                    <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                      <SearchResults results={results} query={query} />
                    </motion.div>
                  ) : (
                    <motion.div key="empty" exit={{ opacity: 0 }}>
                      <EmptyState />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 right-5 z-20">
        <div className="pointer-events-auto">
          <IndexingStatusBadge status={indexing} />
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          refreshFolders();
        }}
        folders={folders}
        indexingFolderId={indexingFolderId}
        onAddFolder={async () => {
          let dir: string | null = null;
          const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

          if (isTauri) {
            try {
              const selected = await open({
                directory: true,
                multiple: false,
                title: "Select Folder to Add",
              });
              if (!selected) return; // User cancelled
              dir = typeof selected === "string" ? selected : selected[0];
            } catch (err) {
              console.error("Native folder dialog error:", err);
              dir = window.prompt("Enter absolute path to folder or file to add:");
            }
          } else {
            dir = window.prompt("Enter absolute path to folder or file to add:");
          }

          if (!dir || !dir.trim()) return;

          addConfiguredFolder(dir.trim());
          await refreshFolders();
        }}
        onIndexFolder={async (folder) => {
          const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
          try {
            setIndexingFolderId(folder.id);
            setIndexing({
              processed: 0,
              total: 100,
              currentFolder: `Indexing ${folder.path}`,
              done: false,
            });

            const res = await api.indexDirectory(folder.path);

            let msg = `Indexing summary for ${folder.path}:\n• Found: ${res.total_files_found} files\n• Successfully indexed: ${res.files_indexed} files (${res.total_chunks_indexed} chunks)`;
            let kind: "info" | "warning" | "error" = "info";

            if (res.errors && res.errors.length > 0) {
              kind = res.files_indexed > 0 ? "warning" : "error";
              const errorSummary = res.errors
                .slice(0, 3)
                .map((e) => `• ${e.file_path || "File"}: ${e.error}`)
                .join("\n");
              msg += `\n\nIssues encountered (${res.errors.length}):\n${errorSummary}`;
              if (res.errors.length > 3) {
                msg += `\n...and ${res.errors.length - 3} more.`;
              }
            } else if (res.total_files_found === 0) {
              kind = "warning";
              msg += "\n\nNo supported files were found in this directory.\n(Supported formats: PDF, DOCX, XLSX, PPTX, Images, and Code/Text files).";
            }

            if (isTauri) {
              await message(msg, {
                title:
                  kind === "error"
                    ? "Indexing Failed"
                    : kind === "warning"
                      ? "Indexing Completed with Warnings"
                      : "Indexing Completed",
                kind,
              });
            } else {
              alert(msg);
            }

            await refreshFolders();
          } catch (err: any) {
            if (isTauri) {
              await message(`Indexing error for ${folder.path}:\n${err.message}`, {
                title: "Indexing Error",
                kind: "error",
              });
            } else {
              alert(`Indexing error: ${err.message}`);
            }
          } finally {
            setIndexingFolderId(null);
          }
        }}
        onRemoveFolder={async (id) => {
          const target = folders.find((f) => f.id === id);
          if (!target) return;
          const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
          let proceed = false;
          if (isTauri) {
            proceed = await confirm(
              `Remove folder ${target.path}?${target.fileCount > 0 ? " This will also purge its indexed files." : ""}`,
              {
                title: "Remove Folder",
                kind: "warning",
              }
            );
          } else {
            proceed = window.confirm(`Remove folder ${target.path}?`);
          }
          if (proceed) {
            try {
              removeConfiguredFolder(target.path);
              await api.deleteFolder(target.path).catch((err) => {
                console.warn("Delete folder endpoint returned error:", err);
              });
              await refreshFolders();
            } catch (err: any) {
              console.error("Failed to delete indexed folder files:", err);
            }
          }
        }}
      />
    </main>
  );
}
