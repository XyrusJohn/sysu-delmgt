import { resolveReleaseConfig } from "./releaseConfig.js";
export const API_CONFIG = resolveReleaseConfig(import.meta.env);
