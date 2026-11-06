## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Codex quality hooks

When the project hooks in `.codex/hooks.json` have been reviewed and enabled:

- `PostToolUse` runs targeted ESLint fixes and Prettier after file changes. Do not
  repeat these commands after each edit. Unused imports are preserved until the
  code is complete; the final validation and commit hook still check them.
- `Stop` runs `pnpm prepush` (Prettier, ESLint and Astro/TypeScript) after changes,
  reusing successful results for unchanged content. Do not run the same full gate
  just before finishing unless the hook is unavailable or its output needs review.
- Run tests appropriate to behavioral changes explicitly; they are not included
  in the automatic gate. Never claim checks passed without observed evidence.
- Hooks never stage files. If a hook reformats a file, reread it before making
  another patch. Group related edits in a single tool call where possible.

If hooks are disabled or awaiting trust, run the checks manually. Hook state and
diagnostic logs live under `.local/codex-quality/` and are not versioned.

## Astro documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
