import path from "path";

export function normalizeRelativeStoragePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, "/").trim();
  const cleaned = path.posix.normalize(`/${normalized}`).replace(/^\//, "");
  if (!cleaned || cleaned === "." || cleaned.startsWith("..") || cleaned.includes("/../")) {
    throw new Error("Invalid storage path");
  }
  return cleaned;
}

export function resolveStorageAbsolutePath(storageRoot: string, relativePath: string): string {
  const normalizedRelative = normalizeRelativeStoragePath(relativePath);
  const absoluteRoot = path.resolve(storageRoot);
  const absolutePath = path.resolve(absoluteRoot, normalizedRelative);

  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error("Path traversal detected");
  }

  return absolutePath;
}
