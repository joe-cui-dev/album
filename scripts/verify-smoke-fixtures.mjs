#!/usr/bin/env node
/** Verify the local, non-private production-smoke fixture pack without uploading anything. */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, "fixtures", "production-smoke");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const privateMetadata = /GPS|Make|Model|Serial|Lens|Owner|Artist|Copyright/i;

const exifAscii = (exif, tag) => {
  if (!exif || exif.subarray(0, 6).toString("ascii") !== "Exif\0\0") return undefined;
  const tiff = exif.subarray(6);
  const littleEndian = tiff.subarray(0, 2).toString("ascii") === "II";
  const u16 = (offset) => littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const u32 = (offset) => littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  const readIfd = (offset) => {
    const count = u16(offset);
    return Array.from({ length: count }, (_, index) => {
      const entry = offset + 2 + index * 12;
      return { tag: u16(entry), type: u16(entry + 2), count: u32(entry + 4), value: u32(entry + 8), valueOffset: entry + 8 };
    });
  };
  const ifd0 = readIfd(u32(4));
  const exifIfd = ifd0.find((entry) => entry.tag === 0x8769);
  const entry = (exifIfd ? readIfd(exifIfd.value) : ifd0).find((candidate) => candidate.tag === tag);
  if (!entry || entry.type !== 2) return undefined;
  const value = entry.count <= 4
    ? tiff.subarray(entry.valueOffset, entry.valueOffset + entry.count)
    : tiff.subarray(entry.value, entry.value + entry.count);
  return value.length === 0 ? undefined : value.toString("ascii").replace(/\0$/, "");
};

const verifyManifest = async (manifestPath) => {
  const fixtureDirectory = path.dirname(manifestPath);
  const fixtureManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const fixture of fixtureManifest.files) {
    const fixturePath = path.join(fixtureDirectory, fixture.file);
    const bytes = await readFile(fixturePath);
    if (sha256(bytes) !== fixture.sha256) throw new Error(`${fixture.file}: SHA-256 differs from manifest`);
    if (fixture.kind === "corrupt-jpeg") {
      let decoded = false;
      try { await sharp(bytes).metadata(); decoded = true; } catch { /* expected */ }
      if (decoded) throw new Error(`${fixture.file}: expected deliberately undecodable JPEG`);
      continue;
    }
    if (fixture.kind === "heic" && bytes.subarray(4, 12).toString("ascii") !== "ftypheic") {
      throw new Error(`${fixture.file}: expected a genuine HEIC ftyp brand`);
    }
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== fixture.signature) throw new Error(`${fixture.file}: expected ${fixture.signature}, received ${metadata.format}`);
    if (metadata.width !== fixture.dimensions.width || metadata.height !== fixture.dimensions.height) throw new Error(`${fixture.file}: dimensions differ from manifest`);
    const exif = metadata.exif;
    if (privateMetadata.test(exif?.toString("latin1") ?? "")) throw new Error(`${fixture.file}: contains private/GPS/device-identifying EXIF metadata`);
    const expected = fixture.metadata ?? {};
    const date = exifAscii(exif, 0x9003);
    const offset = exifAscii(exif, 0x9011);
    if (expected.exifDate !== undefined && (expected.exifDate === null ? date !== undefined : date !== expected.exifDate)) throw new Error(`${fixture.file}: EXIF date expectation failed`);
    if (expected.offset !== undefined && (expected.offset === null ? offset !== undefined : offset !== expected.offset)) throw new Error(`${fixture.file}: EXIF offset expectation failed`);
    if (expected.fileModifiedAt) {
      const modifiedAt = (await stat(fixturePath)).mtime.toISOString();
      if (modifiedAt !== expected.fileModifiedAt) throw new Error(`${fixture.file}: mtime ${modifiedAt} differs from ${expected.fileModifiedAt}`);
    }
    console.log(`${path.relative(root, fixturePath)} ${fixture.sha256}`);
  }
};

await verifyManifest(path.join(directory, "manifest.json"));
try { await verifyManifest(path.join(directory, "run-variants", "manifest.json")); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
console.log("verify:smoke-fixtures: all fixture signatures, metadata, privacy checks, and hashes passed.");
