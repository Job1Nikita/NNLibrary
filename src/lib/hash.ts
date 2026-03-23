import crypto from "crypto";
import fs from "fs";

export async function computeFileHashesAndStats(filePath: string): Promise<{
  sha256: string;
  md5: string;
  size: bigint;
  lastModified: Date;
}> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("Target path is not a file");
  }

  const sha256 = crypto.createHash("sha256");
  const md5 = crypto.createHash("md5");

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      sha256.update(chunk);
      md5.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });

  return {
    sha256: sha256.digest("hex"),
    md5: md5.digest("hex"),
    size: BigInt(stat.size),
    lastModified: stat.mtime
  };
}
