---
name: EA broker-aware market gateway upgrade
description: Signalium EA install-time symbol discovery, mapping conflicts, and regex fallback admin UI
---

Broker symbol discovery resolution order: local exact/alias lookup → suffix stripping → trainer round-trip → admin-approved regex fallback, each cached with 24h refresh and conflicts logged when a raw alias resolves differently than before.

**Why:** brokers rename/suffix symbols inconsistently (e.g. `XAUUSD.a`), and the trainer may be temporarily unavailable, so a layered fallback with audit trail is needed to keep EAs functional without silent mismatches.

**How to apply:** when listing `symbol_mapping_conflicts` for the admin UI, left-join the symbols table twice (aliased) to resolve `previousSymbolId`/`newSymbolId` into human-readable canonical symbol names — the raw table only stores IDs.
