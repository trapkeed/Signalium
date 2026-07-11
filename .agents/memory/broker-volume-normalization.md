---
name: Broker Volume Normalization
description: Volume constraint storage, normalization math, validation, EA init reporting, and MQL5 embedding.
---

# Broker Volume Normalization

## Schema
`broker_volume_constraints` table (lib/db/src/schema/volume-constraints.ts):
- Per (eaRegistrationId, canonicalSymbol) — unique index on both columns.
- Stores volumeMin, volumeMax, volumeStep (all `real`), roundingPolicy enum.
- Upserted by EA on OnInit via POST /api/volume-constraints; updatedAt bumped on each upsert.
- `ROUNDING_POLICIES` const exported: `["ROUND_DOWN", "ROUND_UP", "ROUND_NEAREST"]`.

## Server-side lib (artifacts/api-server/src/lib/volumeNormalizer.ts)
Three pure exports + two DB-backed ones:
- `normalizeVolume(raw, step, policy)` — rounds to nearest step multiple, eliminates float drift via `toFixed(stepDecimals(step))`.
- `validateVolume(normalizedVolume, min, max)` — returns `{ ok, normalizedVolume, error? }`.
- `normalizeAndValidate(raw, constraints)` — convenience wrapper.
- `getSymbolConstraints(eaRegistrationId, canonicalSymbol)` — DB fetch, dynamic import pattern (avoids circular dep).
- `getAllConstraintsForRegistration(eaRegistrationId)` — fetches all symbols for an EA.

## Routes (artifacts/api-server/src/routes/volume-constraints.ts)
Mounted at `/api/volume-constraints`:
- `POST /` — requireApiKeyAuth (EA); upserts constraints; accepts array body.
- `GET /` — session auth; lists all constraints for current user's EA registrations.
- `POST /normalize` — session auth; body: { symbol, rawVolume, eaRegistrationId, roundingPolicy? }.
- `GET /:symbol` — session auth; constraints for one symbol across user's EA registrations.

## MQL5 (artifacts/api-server/src/lib/eaBuilder.ts)
`renderVolumeSectionMql5()` emits into the generated source:
- `#define SIGNALIUM_ROUND_DOWN 0 / ROUND_UP 1 / ROUND_NEAREST 2`
- `#ifndef SIGNALIUM_VOLUME_ROUNDING` — defaults to ROUND_DOWN, overridable in custom builds.
- `SignaliumVolumeConstraint` struct + `g_volumeConstraints[]` array.
- `SignaliumStepDecimals(step)` — decimal-place helper for NormalizeDouble.
- `SignaliumNormaliseVolume(symbol, rawVolume)` — inline MQL5 implementation.
- `SignaliumValidateVolume(symbol, normalisedVolume)` — inline MQL5 implementation.
- `SignaliumFetchVolumeConstraints()` — stub, called in OnInit and 24h refresh.

`OnInit()` calls `SignaliumFetchVolumeConstraints()` before socket connect.
`SignaliumRefreshSymbolDiscoveryIfDue()` also calls `SignaliumFetchVolumeConstraints()`.

## Key decisions
**Why per-EA-registration, not per-broker:** The same broker can return different SYMBOL_VOLUME_MIN/MAX for different account types. Storing per-registration captures the actual account's constraints.
**Why ROUND_DOWN default:** Never opens a larger position than intended; never exceeds max volume.
**Why real (not numeric/decimal) for volume columns:** Lot sizes like 0.01 fit within float32 precision and are written/read by MQL5 doubles; real avoids unnecessary precision overhead.
**Why dynamic import in volumeNormalizer.ts:** Same pattern as symbolNormalizer.ts/eaBuilder.ts — avoids circular dependency between the lib layer and @workspace/db.
