import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import {
  BUILTIN_LABELS,
  findLabel,
  formatLabelText,
  type FamilyLabel,
  type LabelDomain,
} from "./labels";

/** Family labels for a domain (builtins while loading / offline). */
export function useLabels(familyId: string | undefined, domain: LabelDomain) {
  const q = useQuery({
    queryKey: ["labels", familyId, domain],
    queryFn: () =>
      api<{ labels: FamilyLabel[] }>(
        `/labels?familyId=${familyId}&domain=${domain}`,
      ),
    enabled: Boolean(familyId),
    staleTime: 60_000,
  });
  const labels = q.data?.labels ?? BUILTIN_LABELS[domain];
  return {
    labels,
    isLoading: q.isLoading,
    format: (value: string | null | undefined) =>
      formatLabelText(labels, value),
    find: (value: string | null | undefined) => findLabel(labels, value),
  };
}
