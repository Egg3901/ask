// Pull the prebuilt RAG index from Cloudflare R2 into the persistent volume on
// boot if it is not already present. The index (chunk text + vectors) is built
// out-of-band and published to R2; the web service treats it as a read-only
// artifact. Skips the download when the file already exists on the volume.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

const dest = process.env.RAG_DB || "/app/data/index-v2.db";
if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
  console.log(`[fetch-index] present, skipping (${(fs.statSync(dest).size / 1048576).toFixed(0)}MB)`);
  process.exit(0);
}
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const key = process.env.R2_INDEX_KEY || "ask/index-v2.db";
if (!endpoint || !bucket) {
  console.warn("[fetch-index] R2_ENDPOINT/R2_BUCKET unset; leaving index absent (RAG degrades)");
  process.exit(0);
}
fs.mkdirSync(dest.replace(/\/[^/]+$/, ""), { recursive: true });
const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
console.log(`[fetch-index] downloading s3://${bucket}/${key} -> ${dest}`);
const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
await pipeline(res.Body, fs.createWriteStream(dest + ".part"));
fs.renameSync(dest + ".part", dest);
console.log(`[fetch-index] done (${(fs.statSync(dest).size / 1048576).toFixed(0)}MB)`);
