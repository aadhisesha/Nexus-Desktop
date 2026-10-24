import { motion } from "motion/react";
import type { FileResult } from "@/types";
import { ResultCard } from "./ResultCard";

export function SearchResults({
  results,
  query,
}: {
  results: FileResult[];
  query: string;
}) {
  if (results.length === 0) {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="py-6 text-center text-[13px] text-muted-foreground"
      >
        No related files found. Try describing what the document is about or searching for keywords.
      </motion.p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
          {results.length} related files
        </p>
        <span className="text-[11px] text-muted-foreground/50">
          Click any result to open
        </span>
      </div>
      {results.map((r, i) => (
        <ResultCard key={r.id} result={r} index={i} query={query} />
      ))}
    </div>
  );
}
