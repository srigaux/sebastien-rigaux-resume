---
name: curate-prismic-link
description: Turn a supplied article or page URL, with optional editorial notes, into bilingual tech-watch entries and stage linked French and English curated_link drafts in this site's Prismic repository.
---

# Curate a link for the tech watch

Use this skill when the user gives a URL to add to the site's tech watch. The URL is required; a note is optional. Work in the repository root. Follow the existing Prismic skill for reading content and models, while using the scripts below for the requested direct API workflow.

## Read the source

Run `node .agents/skills/curate-prismic-link/scripts/scrape.mjs '<url>' --output /tmp/curated-scrape.json`. Add `--fresh` if the article is time-sensitive or the user wants a fresh read. The script uses `CONTEXT_DEV_API_KEY` from the environment or ignored `.env.local`. It requests Markdown and a screenshot, writes any screenshot to a private temporary file, and leaves base64 out of its JSON result.

Read the returned Markdown and metadata. Inspect the screenshot when page layout or format classification is unclear. Prefer `metadata.canonicalUrl` only when it is the same article or page; otherwise use the resolved URL. Metadata can be stale or misleading, so verify claims against the scraped body and the user's note. If extraction fails or the source language is neither English nor French, stop without writing to Prismic.

## Prepare two editorial versions

Write the French version for `/veille/` and the English version for `/en/tech-watch/`. In each version, make a new title that explains the subject and has useful search terms for this site; do not copy the source page title mechanically. The summary is an original editorial overview, usually two or three sentences (roughly 50–100 words when the source supports it). Explain what the page offers, include a concrete detail or example, and say why it is useful. Avoid generic praise, unsupported claims, the source meta description copied verbatim, and anything resembling the full article. Write a normal prose paragraph; never add a single-item bullet or list marker. Use only lightweight inline Markdown (`**bold**`, `*italic*`, inline code, or an occasional useful link). Do not include headings, lists, images, HTML, or a link back to the source in the summary: the card title already links there. The sender accepts up to 800 characters and 140 words.

Set each Prismic document's `uid` to a URL-safe slug derived from that locale's title. Preserve the title wording in the slug, normalize accents and punctuation, and add a stable short URL suffix only if that locale's slug is already in use.

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
  "fr": { "title": "Intégrer ses composants React à Claude Design", "summary": "Ce guide montre comment Claude Design peut reprendre les vrais composants d’un projet React, avec leurs styles compilés, pour produire des écrans plus proches du produit. Il détaille aussi les vérifications visuelles dans Storybook, un moyen concret de repérer les écarts avant de réutiliser le design." },
  "en": { "title": "Sync a React design system with Claude Design", "summary": "This guide shows how Claude Design can use a project's real React components and compiled styles to produce screens that better match the product. It also walks through visual checks in Storybook, giving teams a concrete way to catch mismatches before reusing the design." }
}
```

`publishedOn`, `credit`, `imageUrl`, `siteIconUrl`, and `discoveredViaUid` are optional. `selectedOn` defaults to today's date in Brussels. Run `node .agents/skills/curate-prismic-link/scripts/send-prismic.mjs /tmp/curated-draft.json` to validate and preview, then run the same command with `--write` to create the two linked drafts in a migration release. `PRISMIC_WRITE_TOKEN` must be available in the environment or ignored `.env.local`. The script does not publish the release. Verify both drafts and their translation link with Prismic, then report the staged result and any missing optional fields.

## Import a saved Teams history

For an authorized historical import, extract only links found in message HTML and retain every occurrence. Normalize known tracking parameters, resolve and review canonical URLs, and set `selectedOn` to the earliest occurrence converted to `Europe/Brussels`. Keep the inventory, editorial decisions, scrape responses, and checkpoints under ignored `.local/` or a private temporary directory; do not commit Teams message content or scraped articles.

Start with `python3 .agents/skills/curate-prismic-link/scripts/teams-inventory.py docs/teams-history.json .local/teams-import/manifest.json`. This refuses to overwrite an existing manifest. Mark each entry's public URL and scrape authorization explicitly before running `node .agents/skills/curate-prismic-link/scripts/teams-scrape.mjs .local/teams-import/manifest.json`; scraped output and screenshots stay outside the repository. Exclude social networks and personal or private links when that is the agreed scope. Treat inaccessible, ambiguous, or failed extractions as blocked rather than guessing from the URL.

Create bilingual editorial drafts only after reading the extracted page. Keep the first Teams date in `selectedOn`, and set `publishedOn` only from a reliable source date. Review 2–5 existing topics for every link; add a topic only when several eligible sources justify it, and update `docs/tech-watch-seed.json` with its stable UID and scope description. Before any retry, reconcile every partial document against Prismic and repeat the exhaustive URL duplicate check. Run `node .agents/skills/curate-prismic-link/scripts/teams-send.mjs .local/teams-import/send-manifest.json 10` only for reviewed entries marked `ready`; it checkpoints document IDs after each migration and never publishes a release.
