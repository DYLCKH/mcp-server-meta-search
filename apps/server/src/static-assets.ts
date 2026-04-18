export interface EmbeddedAsset {
  contentType: string;
  data: Uint8Array;
}

let assets: Record<string, EmbeddedAsset> | null = null;

try {
  const mod = await import("./embedded-assets.generated.js");
  if (mod.EMBEDDED_ASSETS && Object.keys(mod.EMBEDDED_ASSETS).length > 0) {
    assets = mod.EMBEDDED_ASSETS;
  }
} catch {
  // Not available — running in dev mode without embedded assets
}

export const embeddedAssets: Record<string, EmbeddedAsset> | null = assets;
