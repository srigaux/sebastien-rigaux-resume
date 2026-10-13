---
name: curate-prismic-link
description: Turn a supplied article or page URL, with optional editorial notes, into short bilingual tech-watch entries and stage linked French and English curated_link drafts in this site's Prismic repository.
---

# Curate a link for the tech watch

Use this skill when the user gives a URL to add to the site's tech watch. The URL is required; a note is optional. Work in the repository root. Follow the existing Prismic skill for reading content and models, while using the scripts below for the requested direct API workflow.

## Read the source

Run `node .agents/skills/curate-prismic-link/scripts/scrape.mjs '<url>' --output /tmp/curated-scrape.json`. Add `--fresh` if the article is time-sensitive or the user wants a fresh read. The script uses `CONTEXT_DEV_API_KEY` from the environment or ignored `.env.local`. It requests Markdown and a screenshot, writes any screenshot to a private temporary file, and leaves base64 out of its JSON result.

Read the returned Markdown and metadata. Inspect the screenshot when page layout or format classification is unclear. Prefer `metadata.canonicalUrl` only when it is the same article or page; otherwise use the resolved URL. Metadata can be stale or misleading, so verify claims against the scraped body and the user's note. If extraction fails or the source language is neither English nor French, stop without writing to Prismic.

## Prepare two editorial versions

Write the French version for `/veille/` and the English version for `/en/tech-watch/`. In each version, make a new title that explains the subject and has useful search terms for this site; do not copy the source page title mechanically. The summary must be a brief, original overview, usually one or two sentences. Say what the page provides, include one concrete finding or example, and explain why it is useful. Avoid generic praise, unsupported claims, the source meta description copied verbatim, and anything resembling the full article. Use only a single paragraph of lightweight inline Markdown (`**bold**`, `*emphasis*`, inline code, or an occasional link). Do not include headings, lists, images, HTML, or a link back to the source in the summary: the card title already links there.

Use `sourceLanguage` for the **original page's** language (`EN` or `FR`) in both translated documents. Choose the best `format` from the existing model. Use the source's publication date only when reliable, and credit the real author or publisher when known. Choose 2–5 existing topic UIDs from `docs/tech-watch-seed.json`; do not invent a new topic. Set `discoveredViaUid` only when the optional user note identifies an existing discovery source. Use HTTPS Open Graph imagery and favicon URLs from the scrape when valid; never use the screenshot as the article image by default.

Before writing, query Prismic for the canonical URL across published and draft `curated_link` documents using the Prismic connector, and stop on a duplicate. This matters because the direct script can independently detect published duplicates but the Content API cannot enumerate every unpublished draft.

## Stage in Prismic

Write a temporary JSON file containing only the concise draft, never the scraped article. Use this shape:

```json
{
  "canonicalUrl": "https://example.com/article",
  "sourceLanguage": "EN",
  "format": "Article",
  "topics": ["design-systems", "react"],
  "publishedOn": "2026-09-28",
  "credit": "Author name",
  "imageUrl": "https://example.com/image.webp",
  "siteIconUrl": "https://example.com/favicon.png",
  "fr": { "title": "Intégrer ses composants React à Claude Design", "summary": "Un guide concret pour synchroniser un design system React avec Claude Design, styles et vérifications visuelles compris." },
  "en": { "title": "Sync a React design system with Claude Design", "summary": "A practical guide to syncing real React components with Claude Design, including compiled styles and visual checks." }
}
```

`publishedOn`, `credit`, `imageUrl`, `siteIconUrl`, and `discoveredViaUid` are optional. `selectedOn` defaults to today's date in Brussels. Run `node .agents/skills/curate-prismic-link/scripts/send-prismic.mjs /tmp/curated-draft.json` to validate and preview, then run the same command with `--write` to create the two linked drafts in a migration release. `PRISMIC_WRITE_TOKEN` must be available in the environment or ignored `.env.local`. The script does not publish the release. Verify both drafts and their translation link with Prismic, then report the staged result and any missing optional fields.
