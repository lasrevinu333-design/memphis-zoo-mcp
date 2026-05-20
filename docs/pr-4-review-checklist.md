# PR #4 Review Checklist

Branch: `rebuild/ai-split`

## Purpose

Split pure helper logic out of `src/memphis-ai.js` without changing the public responder API.

## Files changed

- `src/ai/memphis-ai-utils.js`
- `src/ai/memphis-ai-intent.js`
- `src/memphis-ai.js`
- `scripts/smoke.mjs`
- `scripts/smoke-ai-utils.mjs`
- `scripts/smoke-ai-intent.mjs`
- `docs/memphis-ai-split.md`

## Required checks before merge

Run:

```bash
npm run smoke
node scripts/smoke-ai-utils.mjs
node scripts/smoke-ai-intent.mjs
```

All three should exit successfully.

## Manual review points

- `createMemphisResponder` remains exported from `src/memphis-ai.js`.
- `src/memphis-ai.js` imports pure helpers from `./ai/memphis-ai-utils.js`.
- `src/memphis-ai.js` imports intent helpers from `./ai/memphis-ai-intent.js`.
- `findLocationCode` is intentionally a small extractor, not the final DB-backed location resolver.
- `isSystemSpecificQuestion` routes obvious operational prompts to local system logic.
- No changes should be made to Render startup, MCP bootstrap, Supabase helpers, or GitHub helpers in this PR.

## Known caveats

- `findLocationCode` is not a final location resolver.
- Future work should add `resolveLocationIntent(text, { runReadOnlySql })` backed by locations, groups, aliases, and later proximity data.
- The package script `smoke:ai-intent` was not added because tool-wrapper filtering blocked the package patch. Use direct `node` commands for now.

## Merge recommendation

Merge only after the smoke commands pass and the PR diff confirms no unrelated runtime wiring changed.
