// Web and Electron: the browser keeps auth-kit's httpOnly session cookie.
import { createApiFetch, createAuthKitClient } from "@sahan-sac/auth-kit-client";
import { API_URL } from "./config";

export const authClient = createAuthKitClient({ baseURL: API_URL, plugins: [] });
export const rawFetch = createApiFetch({ baseURL: API_URL });
