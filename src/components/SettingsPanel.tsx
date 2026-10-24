import { motion, AnimatePresence } from "motion/react";
import { Check, Eye, EyeOff, Loader2, X, AlertCircle, KeyRound } from "lucide-react";
import { useState, useEffect } from "react";
import type { AiProvider, IndexedFolder } from "@/types";
import {
  testConnection,
  getSavedProvider,
  saveActiveProvider,
  getSavedApiKey,
  saveApiKey,
} from "@/services/searchService";
import { FolderList } from "./FolderList";

const providers: Array<{ id: AiProvider; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "anthropic", label: "Anthropic" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  folders: IndexedFolder[];
  onAddFolder: () => void;
  onRemoveFolder: (id: string) => void;
  onIndexFolder: (folder: IndexedFolder) => void;
  indexingFolderId?: string | null;
}

type TestState = { kind: "idle" } | { kind: "loading" } | { kind: "ok" | "error"; message: string };

export function SettingsPanel({
  open,
  onClose,
  folders,
  onAddFolder,
  onRemoveFolder,
  onIndexFolder,
  indexingFolderId,
}: Props) {
  const [provider, setProvider] = useState<AiProvider>(() => getSavedProvider());
  const [apiKey, setApiKey] = useState<string>(() => getSavedApiKey(getSavedProvider()));
  const [visible, setVisible] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  // When panel opens or re-opens, reload saved provider & key
  useEffect(() => {
    if (open) {
      const p = getSavedProvider();
      setProvider(p);
      setApiKey(getSavedApiKey(p));
      setTest({ kind: "idle" });
    }
  }, [open]);

  const handleProviderSelect = (p: AiProvider) => {
    setProvider(p);
    saveActiveProvider(p);
    setApiKey(getSavedApiKey(p));
    setTest({ kind: "idle" });
  };

  const handleKeyChange = (val: string) => {
    setApiKey(val);
    saveApiKey(provider, val);
    setTest({ kind: "idle" });
  };

  async function runTest() {
    if (!apiKey.trim()) {
      setTest({ kind: "error", message: "Please enter an API key" });
      return;
    }
    setTest({ kind: "loading" });
    saveApiKey(provider, apiKey);
    const res = await testConnection(provider, apiKey);
    setTest({ kind: res.ok ? "ok" : "error", message: res.message });
  }

  const hasSavedKey = Boolean(getSavedApiKey(provider));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/70"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed right-0 top-0 z-50 flex h-[100dvh] w-full max-w-[400px] flex-col border-l border-border bg-background shadow-panel will-change-transform"
          >
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Settings</h2>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                aria-label="Close settings"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </motion.button>
            </header>

            <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6">
              <section className="space-y-2.5">
                <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  AI Provider
                </h3>
                <div className="relative flex rounded-lg border border-border bg-surface p-1">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderSelect(p.id)}
                      className="relative flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
                    >
                      {provider === p.id && (
                        <motion.span
                          layoutId="provider-pill"
                          transition={{ type: "spring", stiffness: 320, damping: 30 }}
                          className="absolute inset-0 rounded-md bg-surface-raised border border-border"
                        />
                      )}
                      <span
                        className={`relative ${provider === p.id ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    API Key ({provider.toUpperCase()})
                  </h3>
                  {hasSavedKey && (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-success">
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 focus-within:border-brand/50">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    type={visible ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => handleKeyChange(e.target.value)}
                    placeholder="Enter your API key..."
                    className="w-full bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    transition={{ duration: 0.1 }}
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? "Hide API key" : "Show API key"}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={visible ? "on" : "off"}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.15 }}
                        className="block"
                      >
                        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.1 }}
                  onClick={runTest}
                  disabled={test.kind === "loading" || !apiKey.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised py-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-border-strong disabled:opacity-50"
                >
                  {test.kind === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save & Connect
                </motion.button>

                <AnimatePresence mode="wait">
                  {(test.kind === "ok" || test.kind === "error") && (
                    <motion.p
                      key={test.kind}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`flex items-center gap-1.5 text-[12px] ${
                        test.kind === "ok" ? "text-success" : "text-destructive"
                      }`}
                    >
                      {test.kind === "ok" ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      {test.message}
                    </motion.p>
                  )}
                </AnimatePresence>
              </section>

              <section className="space-y-2.5">
                <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Indexed Folders
                </h3>
                <FolderList
                  folders={folders}
                  onAdd={onAddFolder}
                  onRemove={onRemoveFolder}
                  onIndex={onIndexFolder}
                  indexingFolderId={indexingFolderId}
                />
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
