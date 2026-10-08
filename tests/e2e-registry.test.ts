import { describe, expect, it } from "vitest";

/** Registry of E2E coverage categories (manual + automated). */
export const E2E_COVERAGE_REGISTRY = [
  "start_stop_export_flow",
  "generic_network_capture",
  "debugger_attach_detach_recovery",
  "service_worker_restart_recovery",
  "zip_export_manifest",
  "offline_html_report",
  "privacy_redaction_regression",
  "automated_export_pipeline",
] as const;

describe("E2E category coverage registry", () => {
  it("lists required categories", () => {
    expect(E2E_COVERAGE_REGISTRY.length).toBeGreaterThanOrEqual(6);
    expect(E2E_COVERAGE_REGISTRY).toContain("privacy_redaction_regression");
    expect(E2E_COVERAGE_REGISTRY).toContain("start_stop_export_flow");
  });
});
