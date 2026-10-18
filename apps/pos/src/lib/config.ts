/** Public build-time config. The API base URL is the only thing a white-label build needs. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
export const APP_SCHEME = "luxurypos";
