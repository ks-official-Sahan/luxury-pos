import { newObjectKey, objectPublicUrl, presignBucketUpload } from "@sahan-sac/media-kit/bucket";
import { signCloudinaryUpload } from "@sahan-sac/media-kit/signature";
import { validateMediaUpload } from "@sahan-sac/media-kit/validation";
import type { Infra } from "../infra";
import { assertCan, type Actor } from "../lib/context";
import { AppError } from "../lib/errors";

/**
 * Direct-to-storage uploads (product photos, logos, brand fonts, certificates).
 * The API only signs; bytes never pass through it. Each tenant gets its own folder.
 */
export function signUpload(infra: Infra, actor: Actor, input: { filename: string; contentType: string; bytes: number; purpose: "product" | "brand" | "certificate" }) {
  assertCan(actor, input.purpose === "brand" ? "store.branding" : "catalog.write");
  const folder = `tenants/${actor.tenantId}/${input.purpose}`;
  const check = validateMediaUpload(input.filename, input.bytes, folder);
  if (!check.ok) throw new AppError(422, "invalid_media", "unsupported file", check.errors);
  const account = infra.media.accounts[0];
  if (!account) throw new AppError(503, "media_unavailable", "no media storage is configured");

  if (account.provider === "cloudinary") {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { folder, timestamp };
    return {
      provider: "cloudinary" as const,
      accountId: account.id,
      url: `https://api.cloudinary.com/v1_1/${account.cloudName}/auto/upload`,
      fields: { ...params, api_key: account.apiKey, signature: signCloudinaryUpload(params, account.apiSecret) },
    };
  }
  const ext = input.filename.split(".").pop()?.toLowerCase() ?? "bin";
  const key = newObjectKey(folder, ext);
  const signed = presignBucketUpload(account, { key, contentType: input.contentType, bytes: input.bytes });
  return { provider: account.provider, accountId: account.id, method: "PUT" as const, ...signed, publicUrl: objectPublicUrl(account, key) };
}
