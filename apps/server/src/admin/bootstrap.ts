import process from "node:process";
import { loadConfig, mutateConfig } from "@meta-search/config";
import { hashPassword, isDefaultLegacyHash, isLegacySha256Hash } from "./password.js";

/**
 * Startup hook: if the config file carries a plaintext `admin.password`, hash
 * it with argon2id and persist the result under `admin.password_hash`,
 * scrubbing the plaintext from disk. Also emits warnings for legacy SHA-256
 * hashes and the shipped example default.
 *
 * Safe to call before `resolveConfig` — a fresh load afterwards sees the
 * rewritten file.
 */
export async function bootstrapAdminPassword(configPath: string): Promise<void> {
  const cfg = loadConfig(configPath);
  const plaintext = cfg.admin?.password;

  if (plaintext && plaintext.trim().length > 0) {
    const hash = await hashPassword(plaintext);
    await mutateConfig(configPath, (config) => {
      const admin = { ...(config.admin ?? {}) };
      admin.password_hash = hash;
      delete admin.password;
      config.admin = admin;
    });
    process.stderr.write(
      "[meta-search] Hashed admin.password (argon2id) and wrote admin.password_hash. Plaintext removed from config.\n",
    );
    return;
  }

  const storedHash = cfg.admin?.password_hash;
  if (!storedHash) return;

  if (isDefaultLegacyHash(storedHash)) {
    process.stderr.write(
      "[meta-search] WARNING: admin.password_hash is the shipped example default (SHA-256 of \"password\"). Set admin.password in config.jsonc to a real password; it will be hashed on next start.\n",
    );
    return;
  }

  if (isLegacySha256Hash(storedHash)) {
    process.stderr.write(
      "[meta-search] NOTICE: admin.password_hash is in legacy SHA-256 format. It will be upgraded to argon2id on next successful login.\n",
    );
  }
}
