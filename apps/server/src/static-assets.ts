export interface EmbeddedAsset {
  contentType: string;
  data: Uint8Array;
}

let assetsPromise: Promise<Record<string, EmbeddedAsset> | null> | null = null;

async function loadEmbeddedAssets(): Promise<Record<string, EmbeddedAsset> | null> {
  try {
    const mod = await import("./embedded-assets.generated.js");
    if (mod.EMBEDDED_ASSETS && Object.keys(mod.EMBEDDED_ASSETS).length > 0) {
      return mod.EMBEDDED_ASSETS;
    }
  } catch {
    // Not available — running in dev mode without embedded assets
  }
  return null;
}

export async function getEmbeddedAsset(
  assetPath: string,
): Promise<EmbeddedAsset | null> {
  assetsPromise ??= loadEmbeddedAssets();
  const assets = await assetsPromise;
  return assets?.[assetPath] ?? null;
}
