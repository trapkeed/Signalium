---
name: Config Vault Categories, Rotation & Sync Status
description: Adding structured settings categories, rotate/disable actions, and a trainer sync-status view to an existing encrypted secrets vault.
---

When a user asks to make the app the "source of truth" for secrets and push them to an external service, split the request: keep the push-to-external-service part out of scope and only ship a read-only status/reachability view. The existing pattern here (also used for SSO keys and RunPod credentials) is that the external service never receives raw credentials — only the backend resolves and proxies with them.

**Why:** A sync job that transmits secret material to another host turns a bug or compromise into a live credential-exfiltration channel. This boundary was already established for SSO signing keys and RunPod jobs and should stay consistent.

**How to apply:** When adding rotate/disable to a secrets vault, keep it additive (soft-disable flag + `rotatedAt` timestamp) rather than deleting rows, so existing `resolveManagedConfig`-style vault-first/env-fallback logic keeps working when a secret is disabled. Build the "system settings" grouped-by-category view and the "sync status" view as thin read-only pages that link out to existing detail pages rather than duplicating their edit UI. If these new admin routes aren't part of the orval-generated client, it's fine to fetch directly against the API in the new pages, matching whatever pattern the existing secrets page already uses — don't force a codegen regen just for two read-only pages.

Category must be enforced server-side (reject invalid values against the same enum used elsewhere), not just validated client-side — otherwise stray categories silently break any admin UI that groups/filters by category. Store the category on the audit-log `detail` JSON at write time and filter with a JSON path expression (`detail->>'category' = $1`) rather than skipping category filtering — a "read-only sync/status" scope decision does not exempt correctness features like being able to audit-filter by the same categories the UI groups by.

A sync-status view must persist probe history in its own table rather than only reporting the outcome of the current request — otherwise "last successful check" / "last failure reason" reset on every poll and the view is not trustworthy after a restart or between polls.
