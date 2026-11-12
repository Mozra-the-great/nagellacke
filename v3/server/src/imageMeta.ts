/**
 * Strips identifying metadata from uploaded photos (#451).
 *
 * Photos used to be stored byte for byte, so whatever the camera wrote came back
 * out of `GET /photos/*`: EXIF (GPS position, device make and model, timestamps,
 * serial numbers), XMP, IPTC, PNG text chunks, embedded thumbnails and the
 * trailer data some phones append after the image.
 *
 * This works on the container, not on the pixels: segments or chunks are copied
 * through unchanged or dropped, and the compressed image data is never decoded or
 * re-encoded. That is deliberate. The alternative, a decode/encode round trip
 * through an image library (sharp/libvips), would
 *  - lose quality on every JPEG and WebP upload,
 *  - cost CPU and memory on the small hosts this runs on (the public instance has 1 GB), and
 *  - add a native dependency that has to be built or downloaded on every install.sh,
 *    Docker and self-update run.
 *
 * Orientation is the one piece of EXIF the picture needs: a phone held upright
 * stores the sensor's landscape pixels plus a "rotate by 90" tag. Dropping the tag
 * with the rest would turn every such photo on its side. So the orientation value
 * is read out first and written back as a minimal EXIF block that holds that one
 * tag and nothing else (no location, no device, no time). Rotating the pixels
 * instead would need a lossless DCT transform for JPEG or a re-encode; and
 * every consumer that honoured the tag before (browsers, Coil, mail clients)
 * keeps honouring it, so nothing changes for them.
 *
 * Properties the tests pin down:
 *  - idempotent: stripping an already stripped file returns the same bytes, which is
 *    what lets the startup migration skip files it has already handled;
 *  - what is kept is an allowlist (everything needed to decode and display
 *    correctly, including the ICC colour profile), so an unknown segment or chunk
 *    is dropped, not trusted;
 *  - a file that is not a well-formed JPEG, PNG or WebP container is rejected with
 *    InvalidImageError instead of being stored unscrubbed.
 */

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

export type ImageKind = 'jpeg' | 'png' | 'webp';

/** The container the file's own magic bytes claim, or null. */
export function sniffImageKind(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'RIFF') return 'webp';
  return null;
}

/**
 * Returns the image without metadata (see the file comment). Throws
 * InvalidImageError when the bytes are not a well-formed JPEG, PNG or WebP.
 */
export function stripImageMetadata(buf: Buffer): Buffer {
  switch (sniffImageKind(buf)) {
    case 'jpeg': return stripJpeg(buf);
    case 'png': return stripPng(buf);
    case 'webp': return stripWebp(buf);
    default: throw new InvalidImageError('unsupported image format');
  }
}

// ── EXIF orientation ──────────────────────────────────────────────────────────

const ORIENTATION_TAG = 0x0112;

/**
 * Reads the Orientation tag (2-8) out of a TIFF structure (an EXIF payload without
 * the `Exif\0\0` prefix). Every offset is bounds-checked: this parses untrusted
 * input. Anything unexpected yields 1, "as stored".
 */
export function readExifOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return 1;
  const le = order === 'II';
  const u16 = (o: number): number => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number): number => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return 1;
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) !== ORIENTATION_TAG) continue;
    // type 3 = SHORT, count 1: the value sits in the first two bytes of the value field.
    if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return 1;
    const value = u16(entry + 8);
    return value >= 2 && value <= 8 ? value : 1;
  }
  return 1;
}

/** A TIFF structure with a single IFD entry: Orientation. 26 bytes, no other tags. */
export function orientationTiff(orientation: number): Buffer {
  return Buffer.from([
    0x49, 0x49, 0x2a, 0x00, // "II", 42
    0x08, 0x00, 0x00, 0x00, // IFD0 at offset 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, // Orientation, SHORT, 1, value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

// ── JPEG ──────────────────────────────────────────────────────────────────────

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const EXIF_PREFIX = Buffer.from('Exif\0\0', 'latin1');

function hasPrefix(seg: Buffer, offset: number, text: string): boolean {
  return seg.length >= offset + text.length && seg.toString('latin1', offset, offset + text.length) === text;
}

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new InvalidImageError('not a JPEG');

  const out: Buffer[] = [SOI];
  let orientation = 1;
  let orientationWritten = false;
  let sawScan = false;
  let pos = 2;

  // Placed right before the first segment that is not the JFIF header, so a JFIF
  // file keeps APP0 first.
  const writeOrientationOnce = (): void => {
    if (orientation > 1 && !orientationWritten) {
      const tiff = orientationTiff(orientation);
      const head = Buffer.from([0xff, 0xe1, 0, 0]);
      head.writeUInt16BE(2 + EXIF_PREFIX.length + tiff.length, 2);
      out.push(head, EXIF_PREFIX, tiff);
    }
    orientationWritten = true;
  };

  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw new InvalidImageError('JPEG: expected a marker');
    // Any number of 0xFF fill bytes may precede a marker.
    while (pos + 1 < buf.length && buf[pos + 1] === 0xff) pos += 1;
    if (pos + 1 >= buf.length) break;
    const marker = buf[pos + 1]!;

    if (marker === 0xd9) { // EOI. Whatever follows (MPF images, thumbnails, vendor trailers) is dropped.
      out.push(EOI);
      pos = buf.length;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // standalone markers, no length
      out.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) throw new InvalidImageError('JPEG: truncated segment header');
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > buf.length) throw new InvalidImageError('JPEG: bad segment length');
    const segment = buf.subarray(pos, pos + 2 + length);
    pos += 2 + length;

    if (marker === 0xe0) { // APP0
      if (hasPrefix(segment, 4, 'JFIF\0') && segment.length >= 18) {
        // Keep the JFIF header, drop the embedded thumbnail (a small copy of the
        // uncropped picture): version, units and density stay, thumbnail size becomes 0x0.
        const jfif = Buffer.from(segment.subarray(0, 18));
        jfif.writeUInt16BE(16, 2);
        jfif[16] = 0;
        jfif[17] = 0;
        out.push(jfif);
      }
      continue;
    }
    if (marker === 0xe1 && hasPrefix(segment, 4, 'Exif\0\0')) {
      orientation = readExifOrientation(segment.subarray(4 + EXIF_PREFIX.length));
      continue;
    }
    const keepApp = (marker === 0xe2 && hasPrefix(segment, 4, 'ICC_PROFILE\0'))
      || (marker === 0xee && hasPrefix(segment, 4, 'Adobe'));
    if ((marker >= 0xe0 && marker <= 0xef && !keepApp) || marker === 0xfe) continue; // APPn, COM

    writeOrientationOnce();
    out.push(segment);

    if (marker === 0xda) { // SOS: entropy-coded data follows, copied verbatim up to the next real marker
      sawScan = true;
      let end = pos;
      for (;;) {
        const ff = buf.indexOf(0xff, end);
        if (ff < 0 || ff + 1 >= buf.length) { end = buf.length; break; }
        const next = buf[ff + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { end = ff + 2; continue; } // stuffed byte, restart marker
        if (next === 0xff) { end = ff + 1; continue; } // fill byte
        end = ff;
        break;
      }
      out.push(buf.subarray(pos, end));
      pos = end;
    }
  }

  if (!sawScan) throw new InvalidImageError('JPEG: no image data');
  return Buffer.concat(out);
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/**
 * Chunks needed to decode and display the picture correctly (critical chunks, colour
 * management, transparency, density, animation). Text (tEXt/zTXt/iTXt, which is
 * where XMP lives), eXIf, tIME and every unknown ancillary chunk are not on it.
 */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'hIST', 'pHYs',
  'cICP', 'mDCV', 'cLLI', 'acTL', 'fcTL', 'fdAT',
]);

let crcTable: Uint32Array | undefined;
function crc32(...parts: Buffer[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A complete PNG chunk (length, type, data, CRC). Exported for the tests, which build PNGs by hand. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(head.subarray(4), data), 0);
  return Buffer.concat([head, data, tail]);
}

function stripPng(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new InvalidImageError('not a PNG');

  const out: Buffer[] = [PNG_SIGNATURE];
  let orientation = 1;
  let orientationWritten = false;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let pos = 8;

  while (pos < buf.length && !sawEnd) {
    if (pos + 12 > buf.length) throw new InvalidImageError('PNG: truncated chunk');
    const length = buf.readUInt32BE(pos);
    if (length > buf.length - pos - 12) throw new InvalidImageError('PNG: bad chunk length');
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const chunk = buf.subarray(pos, pos + 12 + length);
    pos += 12 + length;

    if (!sawHeader && type !== 'IHDR') throw new InvalidImageError('PNG: IHDR must come first');
    if (type === 'IHDR') sawHeader = true;
    if (type === 'eXIf') {
      orientation = readExifOrientation(chunk.subarray(8, 8 + length));
      continue;
    }
    if (!PNG_KEEP.has(type)) continue;

    if (type === 'IDAT') {
      sawData = true;
      if (orientation > 1 && !orientationWritten) {
        out.push(pngChunk('eXIf', orientationTiff(orientation)));
        orientationWritten = true;
      }
    }
    if (type === 'IEND') sawEnd = true; // anything after IEND is dropped
    out.push(chunk);
  }

  if (!sawHeader || !sawData || !sawEnd) throw new InvalidImageError('PNG: incomplete');
  return Buffer.concat(out);
}

// ── WebP ──────────────────────────────────────────────────────────────────────

const WEBP_KEEP = new Set(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L']);
const WEBP_IMAGE = new Set(['VP8 ', 'VP8L', 'ANMF']);
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;

/** A RIFF chunk (fourcc, little-endian size, payload, pad byte for an odd size). Exported for the tests. */
export function webpChunk(fourcc: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(payload.length, 4);
  return payload.length % 2 ? Buffer.concat([head, payload, Buffer.alloc(1)]) : Buffer.concat([head, payload]);
}

function stripWebp(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') {
    throw new InvalidImageError('not a WebP');
  }
  // Bytes past the declared RIFF size are not part of the image.
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));

  const kept: Buffer[] = [];
  let vp8x: { index: number; payload: Buffer } | undefined;
  let orientation = 1;
  let sawImage = false;
  let pos = 12;

  while (pos + 8 <= end) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (size > end - pos - 8) throw new InvalidImageError('WebP: bad chunk length');
    const payload = buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);

    if (fourcc === 'EXIF') {
      const tiff = payload.length >= EXIF_PREFIX.length && payload.subarray(0, EXIF_PREFIX.length).equals(EXIF_PREFIX)
        ? payload.subarray(EXIF_PREFIX.length) : payload;
      orientation = readExifOrientation(tiff);
      continue;
    }
    if (!WEBP_KEEP.has(fourcc)) continue; // XMP and anything unknown
    if (WEBP_IMAGE.has(fourcc)) sawImage = true;
    if (fourcc === 'VP8X') {
      if (payload.length < 10) throw new InvalidImageError('WebP: bad VP8X chunk');
      vp8x = { index: kept.length, payload: Buffer.from(payload) };
      kept.push(Buffer.alloc(0)); // placeholder, filled in once the orientation is known
      continue;
    }
    kept.push(webpChunk(fourcc, payload));
  }

  if (!sawImage) throw new InvalidImageError('WebP: no image data');

  if (vp8x) {
    // Orientation can only live in an extended (VP8X) file, which any file that
    // carried an EXIF chunk has to be.
    const keepOrientation = orientation > 1;
    vp8x.payload[0] = (vp8x.payload[0]! & ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP)) | (keepOrientation ? VP8X_FLAG_EXIF : 0);
    kept[vp8x.index] = webpChunk('VP8X', vp8x.payload);
    if (keepOrientation) kept.push(webpChunk('EXIF', orientationTiff(orientation)));
  }

  const body = Buffer.concat(kept);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
