import { motion, AnimatePresence } from "motion/react";
import { Folder, Plus, Trash2, Play, RefreshCw, Loader2 } from "lucide-react";
import type { IndexedFolder } from "@/types";

interface Props {
  folders: IndexedFolder[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onIndex: (folder: IndexedFolder) => void;
  indexingFolderId?: string | null;
}

export function FolderList({ folders, onAdd, onRemove, onIndex, indexingFolderId }: Props) {
  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {folders.map((f) => {
          const isCurrentIndexing = indexingFolderId === f.id;
          const isIndexed = f.fileCount > 0;

          return (
            <motion.div
              key={f.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="group flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-[12px] text-foreground" title={f.path}>
                  {f.path}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {isIndexed ? `${f.fileCount} ${f.fileCount === 1 ? "file" : "files"} indexed` : "Not indexed yet"}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => onIndex(f)}
                  disabled={isCurrentIndexing}
                  title={isIndexed ? `Re-index ${f.path}` : `Index ${f.path}`}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    isCurrentIndexing
                      ? "bg-brand/10 text-brand cursor-wait"
                      : isIndexed
                      ? "border border-border bg-surface hover:bg-border/60 hover:text-foreground text-muted-foreground"
                      : "bg-brand text-brand-foreground hover:bg-brand/90"
                  }`}
                >
                  {isCurrentIndexing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Indexing...</span>
                    </>
                  ) : isIndexed ? (
                    <>
                      <RefreshCw className="h-3 w-3" />
                      <span>Re-index</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 fill-current" />
                      <span>Index</span>
                    </>
                  )}
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => onRemove(f.id)}
                  disabled={isCurrentIndexing}
                  aria-label={`Remove ${f.path}`}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </motion.button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      <motion.button
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.1 }}
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong py-2.5 text-[13px] text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Add Folder
      </motion.button>
    </div>
  );
}
