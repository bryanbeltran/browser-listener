/**
 * Register optional enrichers here (domain recipes, branding, etc.).
 * Core export/report must work with an empty registry.
 */
export { registerEnricher, listEnrichers, applyEnrichers } from "./registry.js";
export { facebookGroupsEnricher } from "./facebook-groups.js";

import { registerEnricher } from "./registry.js";
import { facebookGroupsEnricher } from "./facebook-groups.js";

registerEnricher(facebookGroupsEnricher);
