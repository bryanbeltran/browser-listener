/**
 * Register optional enrichers here (Oracle BUI, domain recipes, branding, etc.).
 * Core export/report must work with an empty registry.
 */
export { registerEnricher, listEnrichers, applyEnrichers } from "./registry.js";
