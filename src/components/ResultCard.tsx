import { motion } from "motion/react";
import {
  FileText,
  FileCode2,
  FileSpreadsheet,
  FileImage,
  FileType2,
  File,
  ExternalLink,
  FolderOpen,
  Sparkles,
  Search,
} from "lucide-react";
import type { FileResult } from "@/types";
import { openFile, revealInFolder } from "@/services/fileService";

const iconFor = {
  pdf: { Icon: FileText, color: "text-file-pdf" },
  word: { Icon: FileType2, color: "text-file-word" },
  excel: { Icon: FileSpreadsheet, color: "text-file-excel" },
  image: { Icon: FileImage, color: "text-file-image" },
  code: { Icon: FileCode2, color: "text-file-code" },
  text: { Icon: File, color: "text-file-text" },
} as const;

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, terms: string[]) {
  if (!terms.length || !text) return text;
  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark
        key={i}
        className="rounded bg-brand/25 px-1 py-0.2 text-foreground font-semibold"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function ResultCard({
  result,
  index,
  query,
}: {
  result: FileResult;
  index: number;
  query: string;
}) {
  const { Icon, color } = iconFor[result.type] || iconFor.text;

  // Extract clean query terms (words with 2+ chars)
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""))
    .filter((t) => t.length >= 2);

  const nameMatches = queryTerms.filter((term) =>
    result.name.toLowerCase().includes(term)
  );

  const snippetMatches = queryTerms.filter((term) =>
    result.snippet.toLowerCase().includes(term)
  );

  const matchedKeywords = Array.from(new Set([...nameMatches, ...snippetMatches]));

  // Clean raw snippet markers like "File: filename [Page X]:"
  let displaySnippet = result.snippet;
  let pageBadge: string | null = null;
  const pageMatch = displaySnippet.match(/\[Page (\d+)\]/i);
  if (pageMatch) {
    pageBadge = `Page ${pageMatch[1]}`;
  }
  displaySnippet = displaySnippet
    .replace(/^File:\s*[^\n]+\n*/i, "")
    .replace(/^\[Page \d+[^\]]*\]:\s*/i, "")
    .trim();

  // Determine match reasoning
  let matchBadgeText = "Semantic AI Match";
  let MatchBadgeIcon = Sparkles;
  if (nameMatches.length > 0 && snippetMatches.length > 0) {
    matchBadgeText = "Title & Content Match";
    MatchBadgeIcon = Search;
  } else if (nameMatches.length > 0) {
    matchBadgeText = "Filename Match";
    MatchBadgeIcon = Search;
  } else if (snippetMatches.length > 0) {
    matchBadgeText = "Keyword Match";
    MatchBadgeIcon = Search;
  }

  const relevancePct = Math.round(result.relevance * 100);

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await openFile(result.path);
  };

  const handleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await revealInFolder(result.path);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut", delay: Math.min(index * 0.03, 0.18) }}
      onClick={handleOpen}
      className="group relative cursor-pointer rounded-xl border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-150 hover:border-brand/40 hover:bg-surface-raised/40 hover:shadow-card-hover"
    >
      <div className="flex items-start gap-3.5">
        {/* File icon */}
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised transition-colors group-hover:bg-brand/10">
          <Icon className={`h-[18px] w-[18px] ${color}`} />
        </div>

        <div className="min-w-0 flex-1">
          {/* Header: File title, badges, action buttons */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] font-semibold text-foreground group-hover:text-brand transition-colors">
                {highlightText(result.name, queryTerms)}
              </h3>
            </div>

            {/* Quick Actions (Open / Reveal in Finder) */}
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleOpen}
                title="Open file in default app"
                className="flex h-7 items-center gap-1 rounded-md border border-border/80 bg-surface px-2 text-[11px] font-medium text-foreground transition-colors hover:border-brand/50 hover:bg-brand/10 hover:text-brand"
              >
                <ExternalLink className="h-3 w-3" />
                <span>Open</span>
              </button>
              <button
                type="button"
                onClick={handleReveal}
                title="Show in Finder"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border/80 bg-surface text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-raised hover:text-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Match criteria explanation bar */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {/* Match Type Badge */}
            <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 font-medium text-brand">
              <MatchBadgeIcon className="h-3 w-3" />
              {matchBadgeText}
            </span>

            {/* Relevance Score Pill */}
            <span className="inline-flex items-center rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
              {relevancePct}% confidence
            </span>

            {pageBadge && (
              <span className="inline-flex items-center rounded-md bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {pageBadge}
              </span>
            )}

            {/* Matched keywords breakdown */}
            {matchedKeywords.length > 0 && (
              <div className="flex items-center gap-1 text-muted-foreground/80">
                <span className="text-[10px] uppercase tracking-wider opacity-60">Matched:</span>
                {matchedKeywords.slice(0, 3).map((kw, i) => (
                  <span
                    key={i}
                    className="rounded bg-brand/15 px-1 py-0.2 font-mono text-[10px] font-medium text-brand"
                  >
                    "{kw}"
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Snippet with highlighted search terms */}
          <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground/90">
            {highlightText(displaySnippet, queryTerms)}
          </p>

          {/* Path footer */}
          <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <span className="uppercase tracking-wide font-medium">{result.typeLabel}</span>
            <span className="opacity-40">·</span>
            <span className="truncate font-mono">{result.path}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
