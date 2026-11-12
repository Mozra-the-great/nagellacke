import * as zlib from 'node:zlib';
import { pngChunk } from './imageMeta';

/**
 * Image fixtures for the metadata tests (#451). The three files are real, decodable 16x8 images made
 * with Pillow, each carrying the same hand-made metadata: Make "SecretCam", Model "Model X-1",
 * a GPS position (52 N 13 E), a timestamp and Orientation 6 (rotate 90 degrees clockwise), plus a
 * JPEG comment / PNG text chunks / XMP packet saying "secret" or "Jane Doe". Pillow decoded the
 * stripped versions with identical pixels, which is how the stripper was verified against a real decoder.
 */

export const JPEG_WITH_METADATA = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QDgRXhpZgAATU0AKgAAAAgABQEPAAIAAAAKAAAASgEQAAIAAAAKAAAAVAESAAMAAAABAAYAAAEyAAIAAAAUAAAAXoglAAQAAAABAAAAcgAAAABTZWNyZXRDYW0ATW9kZWwgWC0xADIwMjQ6MDE6MDIgMDM6MDQ6MDUAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAAKgAAwACAAAAAkUAAAAABAAFAAAAAwAAAMAAAAAAAAAANAAAAAEAAAAfAAAAAQAAAAwAAAABAAAADQAAAAEAAAAYAAAAAQAAACQAAAAB//4AD3Rha2VuIGF0IGhvbWX/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5+8Ifst79n+if+O17f4Q/ZS3bP9D/APHaKK/naWb4vEfxJXODw64wzdclqv8AX3n/2Q==',
  'base64',
);

export const PNG_WITH_METADATA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAIAAAB/FOjAAAAAD3RFWHRBdXRob3IASmFuZSBEb2U0ahlJAAAAM2lUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YT5zZWNyZXQ8L3g6eG1wbWV0YT61RKQdAAAA2GVYSWZNTQAqAAAACAAFAQ8AAgAAAAoAAABKARAAAgAAAAoAAABUARIAAwAAAAEABgAAATIAAgAAABQAAABeiCUABAAAAAEAAAByAAAAAFNlY3JldENhbQBNb2RlbCBYLTEAMjAyNDowMTowMiAwMzowNDowNQAABAABAAIAAAACTgAAAAACAAUAAAADAAAAqAADAAIAAAACRQAAAAAEAAUAAAADAAAAwAAAAAAAAAA0AAAAAQAAAB8AAAABAAAADAAAAAEAAAANAAAAAQAAABgAAAABAAAAJAAAAAGqudQtAAAAN0lEQVR4nGNkYGAQIAWxMMgxMDAwEo9YYBqYiEQsSBqYiUFoGlgIIkwNrPgRVg1seBAuDey4EAC+tgNMPlzl+AAAAABJRU5ErkJggg==',
  'base64',
);

export const WEBP_WITH_METADATA = Buffer.from(
  'UklGRkoBAABXRUJQVlA4WAoAAAAMAAAADwAABwAAVlA4TCUAAAAvD8ABALkyRPQ/dlH/6H9AQds2TJCUP9O3ARiICYgJAHYFuv8BAEVYSUbYAAAATU0AKgAAAAgABQEPAAIAAAAKAAAASgEQAAIAAAAKAAAAVAESAAMAAAABAAYAAAEyAAIAAAAUAAAAXoglAAQAAAABAAAAcgAAAABTZWNyZXRDYW0ATW9kZWwgWC0xADIwMjQ6MDE6MDIgMDM6MDQ6MDUAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAAKgAAwACAAAAAkUAAAAABAAFAAAAAwAAAMAAAAAAAAAANAAAAAEAAAAfAAAAAQAAAAwAAAABAAAADQAAAAEAAAAYAAAAAQAAACQAAAABWE1QIB0AAAA8eDp4bXBtZXRhPnNlY3JldDwveDp4bXBtZXRhPgA=',
  'base64',
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A minimal, valid 1x1 RGB PNG with no metadata, optionally with extra chunks
 * right after IHDR. Stands in for "a photo" in route tests, where the server
 * has to accept the file but its content does not matter.
 */
export function plainPng(extraChunks: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const scanline = Buffer.from([0, 200, 100, 50]); // filter byte + one RGB pixel
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...extraChunks,
    pngChunk('IDAT', zlib.deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A JPEG segment: marker, big-endian length (which counts itself), payload. */
export function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/**
 * A structurally valid JPEG (SOI, the given segments, a minimal SOF0 + SOS with a few
 * entropy-coded bytes, EOI, then optional trailer bytes). It is not decodable,
 * which the stripper does not need: it only walks the segment structure.
 */
export function syntheticJpeg(segments: Buffer[], trailer: Buffer = Buffer.alloc(0)): Buffer {
  const sof = jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
  const sos = jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
  const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]); // includes a stuffed 0xFF
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, sof, sos, scan, Buffer.from([0xff, 0xd9]), trailer]);
}

/** The Exif APP1 segment around a TIFF structure. */
export function exifSegment(tiff: Buffer): Buffer {
  return jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
}

/**
 * A TIFF structure with Orientation plus a GPS-style secret tag, in the given byte order.
 * Layout: header, IFD0 with two entries (Orientation, Make as ASCII pointing at the tail).
 */
export function tiffWithOrientation(orientation: number, byteOrder: 'II' | 'MM' = 'II'): Buffer {
  const le = byteOrder === 'II';
  const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); if (le) b.writeUInt16LE(n); else b.writeUInt16BE(n); return b; };
  const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); if (le) b.writeUInt32LE(n); else b.writeUInt32BE(n); return b; };
  const make = Buffer.from('SecretCam\0', 'latin1'); // 10 bytes
  const entries = [
    Buffer.concat([u16(0x010f), u16(2), u32(make.length), u32(8 + 2 + 2 * 12 + 4)]),
    Buffer.concat([u16(0x0112), u16(3), u32(1), u16(orientation), u16(0)]),
  ];
  return Buffer.concat([Buffer.from(byteOrder, 'latin1'), u16(42), u32(8), u16(entries.length), ...entries, u32(0), make]);
}

/** A RIFF/WebP container around the given chunks (already built with webpChunk). */
export function riffWebp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
