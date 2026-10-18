/**
 * Public build-time config. The API base URL is the only thing a white-label build needs.
 * Empty on web means "same origin" (nginx, the edge worker or the API serves the app),
 * which the auth client still needs as an absolute URL.
 */
const configured = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
export const API_URL = configured || (typeof window !== "undefined" && window.location ? window.location.origin : "http://localhost:8787");
export const APP_SCHEME = "luxurypos";
