import { useListFeatureFlagStates } from "@workspace/api-client-react";

// Gates UI by feature flag key. Flags default to "off" while loading or if
// the key doesn't exist, so a missing/unloaded flag never accidentally
// reveals a gated feature.
export function useFeatureFlags() {
  const { data = {}, isLoading } = useListFeatureFlagStates();
  return { flags: data, isLoading };
}

export function useFeatureFlag(key: string): boolean {
  const { flags } = useFeatureFlags();
  return flags[key] === true;
}
