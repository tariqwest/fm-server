// ============================================================================
// ModelAvailability.ts — Mirrors Swift's ApfelCore.ModelAvailability. The
// Swift helper-binary maps Apple's framework values into this enum on the
// wire so the Node side has a single discriminated union to reason about.
// ============================================================================

export type ModelAvailability =
  | "available"
  | "appleIntelligenceNotEnabled"
  | "deviceNotEligible"
  | "modelNotReady"
  | "unknownUnavailable";

export const ModelAvailability = {
  isAvailable(m: ModelAvailability): boolean {
    return m === "available";
  },

  shortLabel(m: ModelAvailability): string {
    switch (m) {
      case "available":
        return "yes";
      case "appleIntelligenceNotEnabled":
        return "no (Apple Intelligence not enabled)";
      case "deviceNotEligible":
        return "no (device not eligible)";
      case "modelNotReady":
        return "no (model not ready - still downloading?)";
      case "unknownUnavailable":
        return "no (unknown reason)";
    }
  },

  remediation(m: ModelAvailability): string {
    switch (m) {
      case "available":
        return "Model is ready for requests.";
      case "appleIntelligenceNotEnabled":
        return [
          "Apple Intelligence is not turned on for this Mac.",
          "",
          "Fix:",
          "  1. Open System Settings > Apple Intelligence & Siri",
          "  2. Turn Apple Intelligence ON",
          "  3. Ensure Device Language and Siri Language match a supported language",
          "  4. Wait for the on-device model to download (~3-4 GB)",
          "",
          "Details: https://support.apple.com/en-us/121115",
        ].join("\n");
      case "deviceNotEligible":
        return [
          "This Mac is not eligible for Apple Intelligence.",
          "",
          "Apple Intelligence requires an Apple Silicon Mac (M1 or later).",
          "Intel Macs are not supported - this is a hard Apple requirement,",
          "not an fm-server limitation.",
          "",
          "Details: https://support.apple.com/en-us/121115",
        ].join("\n");
      case "modelNotReady":
        return [
          "The on-device model is still downloading or not yet ready.",
          "",
          "Fix:",
          "  1. Keep your Mac on Wi-Fi and power",
          "  2. Check System Settings > Apple Intelligence & Siri",
          "  3. Try again in a few minutes",
          "",
          "Details: https://support.apple.com/en-us/121115",
        ].join("\n");
      case "unknownUnavailable":
        return [
          "The Apple Intelligence model reported an unknown unavailable reason.",
          "",
          "Try:",
          "  - Updating fm-server",
          "  - Checking System Settings > Apple Intelligence & Siri",
          "  - Filing an issue at https://github.com/tariqwest/fm-server/issues",
        ].join("\n");
    }
  },
} as const;
