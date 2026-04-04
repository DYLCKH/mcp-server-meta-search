import { isAbsolute, relative, resolve } from "node:path";

export function resolveAppPath(path: string, baseDir: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

export function resolveStaticAssetPath(
  webRoot: string,
  requestPath: string,
): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  const resolvedPath = resolve(webRoot, relativePath || "index.html");
  const relativeToRoot = relative(webRoot, resolvedPath);

  if (
    relativeToRoot === "" ||
    (!relativeToRoot.startsWith("..") && !isAbsolute(relativeToRoot))
  ) {
    return resolvedPath;
  }

  return null;
}
