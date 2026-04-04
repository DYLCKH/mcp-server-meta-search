import { readFileSync, writeFileSync } from "node:fs";
import { maskKey, HttpProviderError } from "@meta-search/shared";

interface RevokedKeyEntry {
  provider: string;
  key_index: number;
  key_hint: string | Record<string, string>;
  error_status: number | null;
  error_message: string;
  revoked_at: string;
}

function loadInvalidKeys(filePath: string): RevokedKeyEntry[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createKeyRevokedHandler(invalidKeysFilePath: string) {
  const revokedKeys = loadInvalidKeys(invalidKeysFilePath);

  return function onKeyRevoked(
    providerName: string,
    index: number,
    key: unknown,
    error: Error,
  ): void {
    const entry: RevokedKeyEntry = {
      provider: providerName,
      key_index: index,
      key_hint: maskKey(key),
      error_status: error instanceof HttpProviderError ? error.status : null,
      error_message:
        error instanceof Error
          ? error.message.slice(0, 200)
          : String(error).slice(0, 200),
      revoked_at: new Date().toISOString(),
    };

    revokedKeys.push(entry);
    try {
      writeFileSync(
        invalidKeysFilePath,
        JSON.stringify(revokedKeys, null, 2),
        "utf-8",
      );
    } catch (writeErr) {
      const msg =
        writeErr instanceof Error ? writeErr.message : String(writeErr);
      console.error(
        `[meta-search] Failed to write invalid keys file: ${msg}`,
      );
    }
    console.error(
      `[meta-search] Key #${index} for ${providerName} permanently revoked ` +
        `(written to ${invalidKeysFilePath})`,
    );
  };
}
