import { useConfig } from "../../app/config";
import { featureEnabled, type FeatureId } from "./catalog";
export function isFeatureEnabled(id: FeatureId): boolean {
  return featureEnabled(useConfig.getState().config.features, id);
}
export function useFeatureEnabled(id: FeatureId): boolean {
  return useConfig((s) => featureEnabled(s.config.features, id));
}
