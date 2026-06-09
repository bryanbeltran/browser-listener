import { describe, expect, it } from "vitest";

/** Registry of E2E coverage categories (manual + automated). */
export const E2E_COVERAGE_REGISTRY = [
  "consent_gate",
  "start_stop_export_flow",
  "console_capture",
  "network_metadata_har",
  "user_actions",
  "navigation_visibility",
  "multi_frame_content_script",
  "debugger_attach_detach_recovery",
  "service_worker_restart_recovery",
  "zip_export_manifest",
  "offline_html_report",
  "privacy_redaction_regression",
  "optional_artifacts_disabled_by_default",
] as const;

describe("E2E category coverage registry", () => {
  it("lists required categories", () => {
    expect(E2E_COVERAGE_REGISTRY.length).toBeGreaterThanOrEqual(10);
    expect(E2E_COVERAGE_REGISTRY).toContain("privacy_redaction_regression");
    expect(E2E_COVERAGE_REGISTRY).toContain("consent_gate");
  });
});
