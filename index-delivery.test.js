"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("a persistent Railway volume checks the published index before skipping download", () => {
  const source = fs.readFileSync(path.join(__dirname, "scripts", "fetch-index.mjs"), "utf8");
  const head = source.indexOf("HeadObjectCommand");
  const current = source.indexOf("localEtag === remoteEtag");
  const skip = source.indexOf("[fetch-index] current, skipping");

  assert.ok(head >= 0, "the boot path must inspect the R2 object");
  assert.ok(current > head, "freshness must compare the local and remote ETags");
  assert.ok(skip > current, "the volume may skip only after the freshness check");
});
