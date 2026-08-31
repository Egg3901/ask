// Pull the prebuilt RAG index from Cloudflare R2 into the persistent volume on
// boot if it is not already present. The index (chunk text + vectors) is built
// out-of-band and published to R2; the web service treats it as a read-only
// artifact. Skips the download when the file already exists on the volume.
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

const dest = process.env.RAG_DB || "/app/data/index-v2.db";
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const key = process.env.R2_INDEX_KEY || "ask/index-v2.db";
const localReady = fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000;
if (!endpoint || !bucket) {
  console.warn(`[fetch-index] R2_ENDPOINT/R2_BUCKET unset; ${localReady ? "keeping local index" : "RAG degrades"}`);
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

// A Railway volume survives deploys. Presence alone therefore says nothing about
// freshness: the old boot path skipped every newly published index forever. Keep the
// object's ETag beside the database and compare it on every start. If R2 is temporarily
// unavailable, a valid local index is better than turning a healthy service into an
// outage; a first boot with no index still fails loudly.
let remote;
try {
  remote = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
} catch (error) {
  if (localReady) {
    console.warn(`[fetch-index] could not check R2; keeping local index (${error?.name || "error"})`);
    process.exit(0);
  }
  throw error;
}
const etagPath = `${dest}.etag`;
const localEtag = fs.existsSync(etagPath) ? fs.readFileSync(etagPath, "utf8").trim() : "";
const remoteEtag = String(remote.ETag || "").trim();
const sameSize = localReady && Number(remote.ContentLength || 0) === fs.statSync(dest).size;
if (localReady && remoteEtag && localEtag === remoteEtag && sameSize) {
  console.log(`[fetch-index] current, skipping (${(fs.statSync(dest).size / 1048576).toFixed(0)}MB)`);
  process.exit(0);
}

console.log(`[fetch-index] downloading s3://${bucket}/${key} -> ${dest}`);
const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
await pipeline(res.Body, fs.createWriteStream(dest + ".part"));
fs.renameSync(dest + ".part", dest);
if (remoteEtag) fs.writeFileSync(etagPath, `${remoteEtag}\n`);
console.log(`[fetch-index] done (${(fs.statSync(dest).size / 1048576).toFixed(0)}MB)`);
