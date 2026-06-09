import { redactValueSummary } from "../redaction/engine.js";
import type { UserAction } from "../shared/types.js";

export function buildReproRecipe(actions: UserAction[]): string {
  const lines = ["# Repro recipe (generated from captured user actions)", ""];
  let step = 1;
  for (const a of actions) {
    switch (a.type) {
      case "click":
        lines.push(`${step}. Click \`${a.target ?? "element"}\` on ${a.url}`);
        break;
      case "submit":
        lines.push(`${step}. Submit form \`${a.target ?? "form"}\` on ${a.url}`);
        break;
      case "input":
      case "change":
        lines.push(
          `${step}. ${a.type} on \`${a.target ?? "field"}\`${a.valueSummary ? ` (${redactValueSummary(a.valueSummary)})` : ""}`,
        );
        break;
      case "route":
        lines.push(`${step}. Navigate to ${a.url}`);
        break;
      case "visibility":
        lines.push(`${step}. Tab visibility → ${a.valueSummary ?? "changed"}`);
        break;
    }
    step++;
  }
  if (actions.length === 0) lines.push("No user actions recorded.");
  return lines.join("\n");
}
