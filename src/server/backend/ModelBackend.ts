// ============================================================================
// ModelBackend.ts — On-device vs Private Cloud Compute routing.
// Pure, no FoundationModels dependency. The Swift helper does the actual
// dispatch; this type just records the user's choice and parses model-id
// strings into one of the two backends.
// ============================================================================

export type ModelBackend = "onDevice" | "privateCloudCompute";

export const ModelBackend = {
  default: "onDevice" as ModelBackend,

  canonicalModelID(b: ModelBackend): string {
    return b === "onDevice" ? "system" : "pcc";
  },

  displayLabel(b: ModelBackend): string {
    return b === "onDevice" ? "on-device" : "Private Cloud Compute";
  },

  /**
   * Parse a request's `model` field into a backend choice.
   *
   * Unknown values fall back to `onDevice`: OpenAI clients routinely hard-code
   * model ids like `gpt-4`, and fm-server has always served them locally rather
   * than rejecting the request. PCC is strictly opt-in via the documented
   * aliases.
   */
  fromModelName(name: string | null | undefined): ModelBackend {
    const raw = name?.trim().toLowerCase() ?? "";
    if (raw === "") return "onDevice";
    switch (raw) {
      case "pcc":
        return "privateCloudCompute";
      default:
        return "onDevice";
    }
  },
} as const;
