/**
 * Multi-frame zstd decoding for DSH session logs.
 *
 * DSH appends one independently compressed zstd frame per write batch, so a
 * session log is a concatenation of frames. Node's zlib decodes a single frame,
 * so we walk the frame structure ourselves and decode frames one at a time.
 */
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

const DICT_ID_SIZE = [0, 1, 2, 4];
const FCS_SIZE = [0, 2, 4, 8];
export const ZSTD_MAGIC_BYTES = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Byte length of the zstd frame starting at `offset`, or null when malformed. */
export function frameSizeAt(buf, offset) {
  if (offset + 4 > buf.length) return null;
  if (buf.readUInt32LE(offset) !== 0xfd2fb528) return null;
  let p = offset + 4;
  if (p >= buf.length) return null;
  const descriptor = buf[p++];
  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const hasChecksum = (descriptor >> 2) & 1;
  const dictFlag = descriptor & 3;
  if (!singleSegment) p += 1;
  p += DICT_ID_SIZE[dictFlag];
  p += fcsFlag === 0 ? (singleSegment ? 1 : 0) : FCS_SIZE[fcsFlag];
  for (;;) {
    if (p + 3 > buf.length) return null;
    const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    const last = header & 1;
    const type = (header >> 1) & 3;
    const size = header >>> 3;
    if (type === 0) p += size;
    else if (type === 1) p += 1;
    else if (type === 2) p += size;
    else return null;
    if (last) break;
    if (p > buf.length) return null;
  }
  if (hasChecksum) p += 4;
  if (p > buf.length) return null;
  return p - offset;
}

/** Offsets of every well-formed frame found in `buf` (best effort). */
export function splitFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    const size = frameSizeAt(buf, offset);
    if (size == null || size <= 0) break;
    frames.push({ offset, size });
    offset += size;
  }
  return frames;
}

/** Decode concatenated zstd frames into a UTF-8 string. */
export function decodeFrames(buf) {
  const parts = [];
  let offset = 0;
  while (offset < buf.length) {
    const size = frameSizeAt(buf, offset);
    if (size == null || size <= 0) break;
    parts.push(zlib.zstdDecompressSync(buf.subarray(offset, offset + size)));
    offset += size;
  }
  return Buffer.concat(parts).toString('utf8');
}

/** Decode a whole session log file into its JSONL text. */
export function decodeFile(path) {
  return decodeFrames(readFileSync(path));
}

/** Decode a single frame slice; returns null when the bytes are not a frame. */
export function decodeFrameAt(buf, offset) {
  const size = frameSizeAt(buf, offset);
  if (size == null || size <= 0 || offset + size > buf.length) return null;
  try {
    return zlib.zstdDecompressSync(buf.subarray(offset, offset + size)).toString('utf8');
  } catch {
    return null;
  }
}

/** Byte offsets of `ZSTD_MAGIC_BYTES` in `buf`, newest first. */
export function magicOffsetsDescending(buf) {
  const offsets = [];
  let cursor = buf.length;
  while (cursor > 0) {
    const found = buf.lastIndexOf(ZSTD_MAGIC_BYTES, cursor - 1);
    if (found < 0) break;
    offsets.push(found);
    cursor = found;
  }
  return offsets;
}
