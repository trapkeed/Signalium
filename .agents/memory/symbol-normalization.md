---
name: Symbol Normalization — universal alias system
description: Alias enable/disable, noise suffix coverage, seed aliases, EA symbol map embedding.
---

# Symbol Normalization — Universal Alias System

## Schema
`symbol_aliases` has an `enabled boolean default true` column (added). Disabled aliases are excluded from normalization lookups (`loadCache` filters on `enabled = true`) but preserved for re-activation. This is the soft-disable pattern — never delete seeded aliases.

## Noise suffixes (in NOISE_SUFFIXES, symbolNormalizer.ts)
Added: `_i`, `_a`, `_b`, `_c`, `_x` (MT5 underscore variants), `.cash` (dot-cash), trailing `.` (lone dot).
**Why:** Brokers like EURUSD_i, US30.cash, EURUSD. need suffix-strip coverage without explicit seed aliases.

## Seed aliases (SEED_ALIASES, symbolNormalizer.ts)
Non-deducible aliases that suffix-strip can't reach are seeded explicitly:
- `fx_EURUSD` → EURUSD
- `DJ30` → US30
- `WS30` → US30
Already covered by suffix strip (no seed needed): EURUSDm (`m`), EURUSD.pro (`.pro`), EURUSD_i (`_i` now added), EURUSD. (`.` now added), XAUUSDm (`m`), GOLDmicro (`micro`→`gold`→XAUUSD), US30.cash (`.cash` now added).

## Admin alias management
- `PATCH /symbols/admin/aliases/:id` — enable/disable, rename alias string, remap canonical symbol. Invalidates in-memory cache.
- `DELETE /symbols/admin/aliases/:id` — hard delete (use PATCH enabled=false instead for seeded aliases).
- Admin UI aliases tab: clickable status badge toggles enabled/disabled. Disabled rows shown at 50% opacity.

## EA symbol map embedding
`buildSymbolMapForEa(brokerId?)` in `eaBuilder.ts` fetches canonical symbols + universal aliases + broker-specific aliases. Called at EA build time in both `/ea-builds/generate` and `/ea-builds/:buildId/regenerate`. Output passed as third argument to `generateMql5Source()`.

`renderSymbolMapMql5(symbolMap)` emits:
- `SIGNALIUM_CANONICAL_SYMBOLS[]` — all enabled canonical symbols
- `SIGNALIUM_ALIAS_MAP_RAW[]` / `SIGNALIUM_ALIAS_MAP_CANONICAL[]` — parallel alias arrays; broker-specific overrides appended (last-match-wins)
- `SignaliumNormaliseSymbol(string raw)` — MQL5 inline lookup function

**Why last-match-wins:** Universal aliases are prepended; broker-specific overrides are appended. Linear scan from the end means broker wins without needing a separate lookup pass.

## Trainer isolation
Trainer only ever sees canonical symbols — normalization happens at the telemetry ingestion layer before any trainer call. No change needed to trainer interface.

## orval looseObject recurring fix
After every `pnpm --filter @workspace/api-spec run codegen`, run:
`sed -i 's/zod\.looseObject(/zod.object(/g' lib/api-zod/src/generated/api.ts`
This is a permanent recurring step; the orval codegen always emits `looseObject` for `type: object` schemas without `additionalProperties: false`.
