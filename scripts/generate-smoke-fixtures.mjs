#!/usr/bin/env node
/**
 * Creates the non-private, deterministic source files used by the production-smoke
 * runbook.  This is intentionally a local authoring tool: it never uploads a Photo.
 *
 * HEIC is generated with macOS `sips` because the bundled libvips can decode HEIC but
 * cannot encode HEVC on every developer machine.  The manifest records that toolchain
 * and the verifier still decodes the resulting container with Sharp, so a renamed file
 * can never masquerade as HEIC.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureDirectory = path.join(root, "fixtures", "production-smoke");
const runDirectory = path.join(fixtureDirectory, "run-variants");
const modifiedAt = new Date("2024-04-05T06:07:08.000Z");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const base = sharp({
  create: { width: 320, height: 180, channels: 3, background: { r: 54, g: 106, b: 124 } },
});

const jpegWithOffset = await base
  .clone()
  .jpeg({ quality: 88 })
  .withExif({
    IFD0: { DateTime: "2024:04:05 16:07:08" },
    IFD2: { DateTimeOriginal: "2024:04:05 16:07:08", OffsetTimeOriginal: "+10:00" },
  })
  .toBuffer();
const jpegWithoutOffset = await base
  .clone()
  .jpeg({ quality: 88 })
  .withExif({ IFD0: { DateTime: "2023:02:03 04:05:06" }, IFD2: { DateTimeOriginal: "2023:02:03 04:05:06" } })
  .toBuffer();
const png = await base.clone().png().toBuffer();
const corruptJpeg = Buffer.concat([jpegWithOffset.subarray(0, 80), Buffer.from(" deliberately undecodable\n")]);

await mkdir(fixtureDirectory, { recursive: true });
await rm(runDirectory, { force: true, recursive: true });
await mkdir(runDirectory, { recursive: true });
await writeFile(path.join(fixtureDirectory, "jpeg-exif-offset.jpg"), jpegWithOffset);
await writeFile(path.join(fixtureDirectory, "jpeg-exif-no-offset.jpg"), jpegWithoutOffset);
await writeFile(path.join(fixtureDirectory, "png-file-modified.png"), png);
await writeFile(path.join(fixtureDirectory, "undecodable.jpg"), corruptJpeg);
await utimes(path.join(fixtureDirectory, "png-file-modified.png"), modifiedAt, modifiedAt);

// `sips` is the documented, verified HEVC/HEIC authoring toolchain for this fixture.
const heicPath = path.join(fixtureDirectory, "heic-container.heic");
try {
  await execFileAsync("/usr/bin/sips", ["-s", "format", "heic", path.join(fixtureDirectory, "jpeg-exif-offset.jpg"), "--out", heicPath]);
} catch (error) {
  throw new Error(`Unable to generate the genuine HEIC fixture with macOS sips: ${error instanceof Error ? error.message : error}`);
}

const files = [
  {
    file: "jpeg-exif-offset.jpg",
    kind: "jpeg",
    expectedChronology: { localDateTime: "2024-04-05T16:07:08", offset: "+10:00", source: "exif" },
    metadata: { exifDate: "2024:04:05 16:07:08", offset: "+10:00" },
  },
  {
    file: "jpeg-exif-no-offset.jpg",
    kind: "jpeg",
    expectedChronology: { localDateTime: "2023-02-03T04:05:06", offset: null, source: "exif" },
    metadata: { exifDate: "2023:02:03 04:05:06", offset: null },
  },
  {
    file: "png-file-modified.png",
    kind: "png",
    expectedChronology: { localDateTime: "2024-04-05T06:07:08", offset: null, source: "file_modified" },
    metadata: { fileModifiedAt: modifiedAt.toISOString(), exifDate: null },
  },
  {
    file: "heic-container.heic",
    kind: "heic",
    expectedChronology: { localDateTime: "2024-04-05T16:07:08", offset: "+10:00", source: "exif" },
    metadata: { exifDate: "2024:04:05 16:07:08", offset: "+10:00" },
  },
  { file: "undecodable.jpg", kind: "corrupt-jpeg", expectedChronology: null, metadata: {} },
];

for (const entry of files) {
  const contents = await readFile(path.join(fixtureDirectory, entry.file));
  entry.sha256 = sha256(contents);
  entry.bytes = contents.length;
  if (entry.kind !== "corrupt-jpeg") {
    const info = await sharp(contents).metadata();
    entry.signature = info.format;
    entry.dimensions = { width: info.width, height: info.height };
  } else {
    entry.signature = "jpeg";
    entry.dimensions = null;
  }
}

const manifest = {
  version: 1,
  provenance: {
    generatedBy: "scripts/generate-smoke-fixtures.mjs",
    heicToolchain: "macOS sips -s format heic (genuine HEVC HEIC container)",
    privacy: "Synthetic colour fields only; no GPS, device-identifying, or private metadata.",
  },
  files,
};
await writeFile(path.join(fixtureDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Produce format-valid, byte-unique variants. A one-pixel synthetic colour change keeps
// dimensions and chronology semantics but gives every smoke run a different upload hash.
const variants = [];
for (const entry of files.filter((candidate) => candidate.kind !== "corrupt-jpeg")) {
  const name = `${path.parse(entry.file).name}-${randomBytes(8).toString("hex")}${path.extname(entry.file)}`;
  const variant = path.join(runDirectory, name);
  // This bundled Sharp build can inspect HEIC metadata but not always decode its HEVC pixels.
  // Build the HEIC run variant from the equivalent synthetic JPEG source, then use `sips`
  // for the verified HEVC encoding path.
  const source = await readFile(path.join(fixtureDirectory, entry.kind === "heic" ? "jpeg-exif-offset.jpg" : entry.file));
  const marker = await sharp({ create: { width: 1, height: 1, channels: 3, background: `#${randomBytes(3).toString("hex")}` } }).png().toBuffer();
  if (entry.kind === "heic") {
    const temporaryJpeg = path.join(runDirectory, `${path.parse(name).name}.jpg`);
    await sharp(source).composite([{ input: marker, left: 0, top: 0 }]).jpeg({ quality: 88 }).withExif({
      IFD0: { DateTime: "2024:04:05 16:07:08" },
      IFD2: { DateTimeOriginal: "2024:04:05 16:07:08", OffsetTimeOriginal: "+10:00" },
    }).toFile(temporaryJpeg);
    await execFileAsync("/usr/bin/sips", ["-s", "format", "heic", temporaryJpeg, "--out", variant]);
    await rm(temporaryJpeg);
  } else if (entry.kind === "jpeg") {
    const hasOffset = entry.metadata.offset !== null;
    await sharp(source).composite([{ input: marker, left: 0, top: 0 }]).jpeg({ quality: 88 }).withExif({
      IFD0: { DateTime: entry.metadata.exifDate },
      IFD2: hasOffset ? { DateTimeOriginal: entry.metadata.exifDate, OffsetTimeOriginal: entry.metadata.offset } : { DateTimeOriginal: entry.metadata.exifDate },
    }).toFile(variant);
  } else {
    await sharp(source).composite([{ input: marker, left: 0, top: 0 }]).png().toFile(variant);
    await utimes(variant, modifiedAt, modifiedAt);
  }
  const contents = await readFile(variant);
  const info = await sharp(contents).metadata();
  variants.push({ ...entry, file: name, sha256: sha256(contents), bytes: contents.length, signature: info.format, dimensions: { width: info.width, height: info.height } });
  console.log(`${path.relative(root, variant)} ${sha256(contents)}`);
}
await writeFile(path.join(runDirectory, "manifest.json"), `${JSON.stringify({ version: 1, provenance: { generatedBy: "scripts/generate-smoke-fixtures.mjs", runVariant: true }, files: variants }, null, 2)}\n`);

console.log(`Generated ${files.length} smoke fixtures in ${path.relative(root, fixtureDirectory)}.`);
