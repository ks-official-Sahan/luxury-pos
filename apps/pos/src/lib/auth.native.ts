// iOS / Android: the session cookie lives in the Keychain / Keystore via SecureStore.
import { expoClient } from "@better-auth/expo/client";
import { createApiFetch, createAuthKitClient } from "@sahan-sac/auth-kit-client";
import * as SecureStore from "expo-secure-store";
import { API_URL, APP_SCHEME } from "./config";

export const authClient = createAuthKitClient({
  baseURL: API_URL,
  plugins: [expoClient({ scheme: APP_SCHEME, storagePrefix: APP_SCHEME, storage: SecureStore })],
});

// Better Auth's Expo client reads the cookie asynchronously, so it is attached in the fetch itself.
export const rawFetch = createApiFetch({
  baseURL: API_URL,
  appOrigin: `${APP_SCHEME}://`,
  fetch: async (input, init) => {
    const cookie = await authClient.getCookie();
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("cookie", cookie);
    return fetch(input, { ...init, headers, credentials: "omit" });
  },
});
