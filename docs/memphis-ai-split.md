# Memphis AI Split

Branch: `rebuild/ai-split`

## Goal

Reduce the size and risk of `src/memphis-ai.js` by extracting pure helpers first, then moving behavior-heavy sections in later passes.

## Current branch contents

- Adds `src/ai/memphis-ai-utils.js`.
- Adds smoke test imports and assertions for the extracted helpers.
- Does not yet change `src/memphis-ai.js` runtime behavior.

## First extracted helper group

The new module contains pure utility helpers:

- SQL string escaping helpers
- Loose text normalization
- ISO date extraction/validation
- relative date and weekday helpers
- human time parsing
- add-minutes time helper
- bounded integer parsing

## Safety approach

1. Add helper module.
2. Add smoke assertions.
3. Run/verify tests.
4. Only then patch `src/memphis-ai.js` to import helpers and remove duplicates.
5. Keep the runtime export `createMemphisResponder` unchanged.

## Next planned step

Patch only the top helper block in `src/memphis-ai.js` to import from `src/ai/memphis-ai-utils.js`, then run smoke tests before opening a PR.
