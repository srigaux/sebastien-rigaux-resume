import { createPortal } from "react-dom";
import WatchSearchCard, { type WatchSearchHit } from "./WatchSearchCard";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/types";
import { ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY, ALGOLIA_INDEX_NAME } from "@/lib/algolia";

const copy = {
  fr: {
    close: "Fermer la recherche", label: "Rechercher dans la veille", placeholder: "Un outil, une technologie, une idée…",
    hint: "Recherchez dans toute la veille, tous sujets confondus.", all: "Tous les formats",
    original: "Ouvrir le lien original", clear: "Effacer la recherche", browse: "Revenir aux liens", loading: "Recherche en cours…",
    empty: "Aucun lien trouvé", advice: "Essayez un terme plus général ou un autre format.",
    error: "La recherche est momentanément indisponible.", retry: "Réessayer",
    result: "résultat", results: "résultats", previous: "Précédent", next: "Suivant",
    page: "Page", of: "sur", format: "Format", powered: "Recherche avec Algolia",
    formats: ["Article", "Vidéo", "Dépôt de code", "Nouveauté", "Documentation", "Outil", "Autre"],
  },
  en: {
    close: "Close search", label: "Search the tech watch", placeholder: "A tool, a technology, an idea…",
    hint: "Search the entire tech watch, across all topics.", all: "All formats",
    original: "Open original link", clear: "Clear search", browse: "Back to browsing", loading: "Searching…",
    empty: "No links found", advice: "Try a broader term or a different format.",
    error: "Search is temporarily unavailable.", retry: "Try again",
    result: "result", results: "results", previous: "Previous", next: "Next",
    page: "Page", of: "of", format: "Format", powered: "Search with Algolia",
    formats: ["Article", "Video", "Repository", "Release", "Documentation", "Tool", "Other"],
  },
};
const formats = ["Article", "Video", "Repository", "Release", "Documentation", "Tool", "Other"];
type WatchHit = WatchSearchHit;
type Results = { formatCounts: Record<string, number>; totalBeforeFormat: number; query: string; hits: WatchHit[]; nbHits: number; nbPages: number };
let clientPromise: Promise<ReturnType<typeof import("algoliasearch/lite").liteClient>> | undefined;
function getClient() {
  return clientPromise ??= import("algoliasearch/lite").then(({ liteClient }) => liteClient(ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY)).catch(error => { clientPromise = undefined; throw error; });
}
const control = "min-h-11 cursor-pointer rounded-sm border border-rule px-4 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40";

// Render text nodes only: indexed content never becomes HTML.
function Highlight({ text, query = "" }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return <>{text}</>;
  const expression = new RegExp(`(${terms.join("|")})`, "ig");
  return <>{text.split(expression).map((part, i) => i % 2 ? <mark key={i} className="bg-accent/15 text-inherit underline decoration-accent/50 underline-offset-4">{part}</mark> : part)}</>;
}

export default function WatchSearchPanel({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [triggerTarget, setTriggerTarget] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [revision, setRevision] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = Boolean(query.trim() || format);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(location.search);
      setQuery((params.get("q") || "").slice(0, 200));
      const selected = params.get("format") || "";
      setFormat(formats.includes(selected) ? selected : "");
      setExpanded(Boolean(params.get("q")?.trim() || formats.includes(selected)));
      setPage(0);
    };
    setTriggerTarget(document.querySelector<HTMLElement>("[data-watch-search-trigger]"));
    restore(); setInitialized(true);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (expanded && focusOnOpen.current) {
      input.current?.focus();
      focusOnOpen.current = false;
    }
  }, [expanded]);

  useEffect(() => {
    const browse = document.querySelector<HTMLElement>("[data-watch-browse]");
    if (browse) browse.hidden = active;
    return () => { if (browse) browse.hidden = false; };
  }, [active]);

  useEffect(() => {
    if (!initialized) return;
    const url = new URL(location.href);
    query.trim() ? url.searchParams.set("q", query.trim()) : url.searchParams.delete("q");
    format ? url.searchParams.set("format", format) : url.searchParams.delete("format");
    history.replaceState(history.state, "", url);
    if (!expanded) { setState("idle"); setResults(null); return; }
    let cancelled = false;
    setState("loading");
    const timer = window.setTimeout(async () => {
      try {
        const [client, { renderSummaryMarkdown }] = await Promise.all([getClient(), import("@/lib/watch-markdown")]);
        const response = await client.search<WatchHit>({ requests: [{
          indexName: ALGOLIA_INDEX_NAME,
          query: query.trim(), filters: `locale:${locale}${format ? ` AND format:${format}` : ""}`, hitsPerPage: 10, page, attributesToRetrieve: ["title", "summary", "path", "format", "topics", "topicDetails", "selectedOn", "url", "image", "siteIcon", "source", "credit", "sourceLanguage", "textLanguage"], attributesToHighlight: [], facets: ["format"]
        }, ...(format ? [{
          // Count alternative formats without applying this facet's own filter.
          indexName: ALGOLIA_INDEX_NAME, query: query.trim(), filters: `locale:${locale}`,
          facets: ["format"], hitsPerPage: 0, analytics: false,
        }] : [])] });
        const result = response.results[0];
        if (!result || !("hits" in result)) throw new Error("Unexpected search response");
        const facetResult = format ? response.results[1] : result;
        if (!facetResult || !("hits" in facetResult)) throw new Error("Unexpected facet response");
        if (!cancelled) { setResults({ formatCounts: facetResult.facets?.format ?? {}, totalBeforeFormat: facetResult.nbHits ?? 0, query: query.trim(), hits: result.hits.map((hit: WatchHit) => ({ ...hit, summaryHtml: renderSummaryMarkdown(hit.summary) })), nbHits: result.nbHits ?? 0, nbPages: result.nbPages ?? 0 }); setState("ready"); }
      } catch { if (!cancelled) setState("error"); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, format, page, locale, expanded, revision, initialized]);

  function clear() { setQuery(""); setFormat(""); setPage(0); input.current?.focus(); }
  function close() {
    setQuery(""); setFormat(""); setPage(0); setExpanded(false);
    trigger.current?.focus();
  }
  function changePage(next: number) { setPage(next); heading.current?.focus(); }
  return <div className={expanded ? "mt-6 mb-10" : ""}>
    {triggerTarget && createPortal(<>
      <button
        ref={trigger}
        type="button"
        aria-label={expanded ? t.close : t.label}
        title={expanded ? t.close : t.label}
        aria-expanded={expanded}
        aria-controls="watch-search-controls"
        onClick={() => { if (expanded) close(); else { focusOnOpen.current = true; setExpanded(true); } }}
        className="flex size-11 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-5" aria-hidden="true">{expanded ? <path d="m6 6 12 12M18 6 6 18"/> : <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>}</svg>
      </button>
    </>, triggerTarget)}
    <div id="watch-search-controls" hidden={!expanded} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
    <search aria-label={t.label}>
      <form onSubmit={event => { event.preventDefault(); if (active) { setRevision(value => value + 1); heading.current?.focus(); } }}>
        <label htmlFor="watch-query" className="mb-3 block text-base font-semibold text-ink">{t.label}</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-sm border border-muted bg-paper px-4 focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-accent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-5 shrink-0 text-accent" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input ref={input} id="watch-query" type="search" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder={t.placeholder} aria-describedby="watch-search-hint" aria-controls={active ? "watch-search-results" : undefined} className="min-h-12 w-full min-w-0 bg-transparent text-base text-ink caret-accent outline-none placeholder:text-muted focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden" />
            {state === "loading" && <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-accent"><svg viewBox="0 0 24 24" fill="none" className="size-5 motion-safe:animate-spin" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-20"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>}
            {query && <button type="button" onClick={() => { setQuery(""); setPage(0); input.current?.focus(); }} aria-label={t.clear} className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-accent/10 hover:text-accent"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>}
          </div>
          <label className="sr-only" htmlFor="watch-format">{t.format}</label>
          <div className="relative sm:w-64 sm:shrink-0">
          <select id="watch-format" value={format} onChange={event => { setFormat(event.target.value); setPage(0); }} className="min-h-12 w-full cursor-pointer appearance-none rounded-sm border border-muted bg-paper py-3 pr-12 pl-4 text-base leading-normal text-ink">
            <option value="">{t.all}{results ? ` (${results.totalBeforeFormat})` : ""}</option>
            {formats.filter(value => !results || (results.formatCounts?.[value] ?? 0) > 0 || value === format).map(value => <option key={value} value={value}>{t.formats[formats.indexOf(value)]}{results ? ` (${results.formatCounts?.[value] ?? 0})` : ""}</option>)}
          </select>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm text-muted">
          <p id="watch-search-hint">{t.hint}</p><span className="text-xs">{t.powered}</span>
        </div>
      </form>
    </search>
    {active && <section id="watch-search-results" aria-label={t.label} className="mt-8 border-t border-rule">
      <div className="flex flex-wrap items-center justify-between gap-3 py-5">
        <h2 ref={heading} tabIndex={-1} className="min-w-0 break-words font-display text-xl font-semibold text-ink" role="status" aria-live="polite" aria-atomic="true">{state === "loading" ? t.loading : state === "error" ? t.error : results ? `${results.nbHits} ${results.nbHits === 1 ? t.result : t.results}${query.trim() ? ` · « ${query.trim()} »` : ""}` : t.loading}</h2>
        <button type="button" className={control} onClick={clear}>{t.browse}</button>
      </div>
      <div aria-busy={state === "loading"}>
        {state === "error" ? <div className="border-y border-rule py-8"><button type="button" className={control} onClick={() => setRevision(value => value + 1)}>{t.retry}</button></div> : results?.nbHits === 0 ? <div className="border-t border-rule py-10 sm:py-14"><h3 className="font-display text-2xl font-semibold text-ink">{t.empty}</h3><p className="mt-3 text-muted">{t.advice}</p><button type="button" onClick={clear} className={`${control} mt-6`}>{t.clear}</button></div> : results ? <>
          <div className="lg:mr-[20rem] divide-y divide-rule border-b border-rule">
            {results.hits.map(hit => <WatchSearchCard key={hit.objectID} hit={hit} locale={locale} title={<Highlight text={hit.title} query={results.query}/>}/>)}
          </div>
          {results.nbPages > 1 && <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={state === "loading" || page === 0} className={control} onClick={() => changePage(page - 1)}>{t.previous}</button><span className="text-sm text-muted tabular-nums">{t.page} {page + 1} {t.of} {results.nbPages}</span><button type="button" disabled={state === "loading" || page + 1 >= results.nbPages} className={control} onClick={() => changePage(page + 1)}>{t.next}</button></nav>}
        </> : <div className="h-28 border-t border-rule bg-accent/5 motion-safe:animate-pulse" aria-hidden="true" />}
      </div>
    </section>}
    </div>
  </div>;
}
