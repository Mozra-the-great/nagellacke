import { describe, expect, it } from 'vitest';
import * as zlib from 'node:zlib';
import {
  InvalidImageError, orientationTiff, pngChunk, readExifOrientation, sniffImageKind, stripImageMetadata, webpChunk,
} from './imageMeta';
import {
  JPEG_WITH_METADATA, PNG_WITH_METADATA, WEBP_WITH_METADATA,
  exifSegment, jpegSegment, plainPng, riffWebp, syntheticJpeg, tiffWithOrientation,
} from './testImages';

/** True when `needle` (text) occurs anywhere in `haystack`. */
function contains(haystack: Buffer, needle: string): boolean {
  return haystack.includes(Buffer.from(needle, 'latin1'));
}

const LEAKS = ['SecretCam', 'Model X-1', 'Jane Doe', 'secret', 'taken at home', '2024:01:02'];

const REAL_FILES: [string, Buffer][] = [
  ['JPEG', JPEG_WITH_METADATA],
  ['PNG', PNG_WITH_METADATA],
  ['WebP', WEBP_WITH_METADATA],
];

describe('stripImageMetadata: real files with EXIF (GPS, device, time), XMP and text', () => {
  it.each(REAL_FILES)('%s: removes device, GPS, time, XMP and comments', (_name, original) => {
    // Guard: the fixture really does carry the metadata, or the assertion below proves nothing.
    expect(LEAKS.some((leak) => contains(original, leak))).toBe(true);

    const clean = stripImageMetadata(original);
    for (const leak of LEAKS) expect(contains(clean, leak)).toBe(false);
    expect(clean.length).toBeLessThan(original.length);
  });

  it.each(REAL_FILES)('%s: keeps the orientation (6) and nothing else from EXIF', (_name, original) => {
    const clean = stripImageMetadata(original);
    // The kept block is exactly the 26-byte one-tag TIFF structure, which reads back as 6 ...
    const at = clean.indexOf(orientationTiff(6));
    expect(at).toBeGreaterThan(0);
    expect(readExifOrientation(clean.subarray(at, at + 26))).toBe(6);
    // ... and the original's GPS block is gone.
    expect(contains(clean, 'GPS')).toBe(false);
  });

  it.each(REAL_FILES)('%s: is idempotent, so a second pass changes nothing', (_name, original) => {
    const once = stripImageMetadata(original);
    expect(stripImageMetadata(once).equals(once)).toBe(true);
  });

  it('keeps the compressed image data of the JPEG byte for byte (no re-encode)', () => {
    const scanOf = (jpeg: Buffer): Buffer => jpeg.subarray(jpeg.indexOf(Buffer.from([0xff, 0xda])));
    expect(scanOf(stripImageMetadata(JPEG_WITH_METADATA)).equals(scanOf(JPEG_WITH_METADATA))).toBe(true);
  });
});

describe('stripImageMetadata: JPEG structure', () => {
  it('drops APPn/COM segments, thumbnails and trailers but keeps decoding-relevant ones', () => {
    const icc = jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1, 9, 9, 9])]));
    const adobe = jpegSegment(0xee, Buffer.from('Adobe\0\0\0\0\0\0\0', 'latin1'));
    const mpf = jpegSegment(0xe2, Buffer.from('MPF\0 secret multi-picture index', 'latin1'));
    const jfif = jpegSegment(0xe0, Buffer.concat([
      Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 1, 0, 72, 0, 72, 2, 1]), Buffer.from('thumbnail-secret', 'latin1'),
    ]));
    const xmp = jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<xmp>secret</xmp>', 'latin1'));
    const photoshop = jpegSegment(0xed, Buffer.from('Photoshop 3.0\0secret', 'latin1'));
    const comment = jpegSegment(0xfe, Buffer.from('secret comment', 'latin1'));
    const file = syntheticJpeg(
      [jfif, exifSegment(tiffWithOrientation(1)), xmp, photoshop, comment, icc, adobe, mpf],
      Buffer.from('TRAILER secret appended after EOI', 'latin1'),
    );

    const clean = stripImageMetadata(file);
    for (const leak of ['secret', 'SecretCam', 'TRAILER', 'MPF']) expect(contains(clean, leak)).toBe(false);
    // Kept: ICC profile (colours), Adobe marker (CMYK/YCCK decoding), JFIF header (density) ...
    expect(contains(clean, 'ICC_PROFILE')).toBe(true);
    expect(contains(clean, 'Adobe')).toBe(true);
    expect(contains(clean, 'JFIF')).toBe(true);
    // ... with the JFIF thumbnail removed (the header now declares a 16 byte payload) ...
    const at = clean.indexOf(Buffer.from('JFIF\0', 'latin1'));
    expect(clean.readUInt16BE(at - 2)).toBe(16);
    expect(clean[at + 12]).toBe(0);
    expect(clean[at + 13]).toBe(0);
    // ... and the file still ends with EOI right after the scan.
    expect(clean.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it('writes no EXIF block when the orientation is absent or "normal"', () => {
    expect(contains(stripImageMetadata(syntheticJpeg([exifSegment(tiffWithOrientation(1))])), 'Exif')).toBe(false);
    expect(contains(stripImageMetadata(syntheticJpeg([exifSegment(orientationTiff(1))])), 'Exif')).toBe(false);
    expect(contains(stripImageMetadata(syntheticJpeg([])), 'Exif')).toBe(false);
  });

  it.each([2, 3, 5, 6, 7, 8])('preserves orientation %i, little and big endian', (orientation) => {
    for (const order of ['II', 'MM'] as const) {
      const clean = stripImageMetadata(syntheticJpeg([exifSegment(tiffWithOrientation(orientation, order))]));
      expect(contains(clean, 'SecretCam')).toBe(false);
      const at = clean.indexOf(Buffer.from('Exif\0\0', 'latin1'));
      expect(at).toBeGreaterThan(0);
      expect(readExifOrientation(clean.subarray(at + 6, at + 6 + 26))).toBe(orientation);
    }
  });

  it('keeps JFIF first and puts the orientation block right behind it', () => {
    const jfif = jpegSegment(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]));
    const clean = stripImageMetadata(syntheticJpeg([jfif, exifSegment(tiffWithOrientation(3))]));
    expect(clean.subarray(2, 4).equals(Buffer.from([0xff, 0xe0]))).toBe(true);
    expect(clean.indexOf(Buffer.from([0xff, 0xe1]))).toBe(2 + 2 + 16);
  });

  it('does not mistake 0xFF bytes inside the scan for markers, and tolerates restart markers', () => {
    const file = syntheticJpeg([]);
    const withRst = Buffer.concat([
      file.subarray(0, file.length - 2), Buffer.from([0xff, 0xd0, 0x01, 0xff, 0x00]), Buffer.from([0xff, 0xd9]),
    ]);
    expect(stripImageMetadata(withRst).equals(withRst)).toBe(true);
  });

  it('handles several scans (progressive JPEG)', () => {
    const sos = jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
    const base = syntheticJpeg([]);
    const progressive = Buffer.concat([
      base.subarray(0, base.length - 2), jpegSegment(0xc4, Buffer.from([0, 1, 2])), sos,
      Buffer.from([0xaa, 0xff, 0x00]), Buffer.from([0xff, 0xd9]),
    ]);
    expect(stripImageMetadata(progressive).equals(progressive)).toBe(true);
  });

  it.each([
    ['a truncated segment', Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0x00, 0x40, 1, 2, 3])])],
    ['a segment length of 0', Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0x00, 0x00])])],
    ['garbage where a marker belongs', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]), Buffer.from('hello world')])],
    ['no scan data at all', Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSegment(0xdb, Buffer.alloc(4)), Buffer.from([0xff, 0xd9])])],
    ['only the magic bytes', Buffer.from([0xff, 0xd8, 0xff])],
  ])('rejects %s', (_name, bad) => {
    expect(() => stripImageMetadata(bad)).toThrow(InvalidImageError);
  });
});

describe('stripImageMetadata: PNG structure', () => {
  const text = pngChunk('tEXt', Buffer.from('Author\0Jane Doe', 'latin1'));
  const time = pngChunk('tIME', Buffer.from([0x07, 0xe8, 1, 2, 3, 4, 5]));
  const priv = pngChunk('prVt', Buffer.from('private secret'));
  const icc = pngChunk('iCCP', Buffer.concat([Buffer.from('p\0\0', 'latin1'), zlib.deflateSync(Buffer.from('profile'))]));
  const phys = pngChunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]));

  it('drops text, time and unknown ancillary chunks, keeps colour and density chunks', () => {
    const clean = stripImageMetadata(plainPng([text, time, priv, icc, phys]));
    expect(contains(clean, 'tEXt')).toBe(false);
    expect(contains(clean, 'tIME')).toBe(false);
    expect(contains(clean, 'prVt')).toBe(false);
    expect(contains(clean, 'Jane Doe')).toBe(false);
    expect(clean.equals(plainPng([icc, phys]))).toBe(true);
  });

  it('leaves a PNG without metadata byte for byte unchanged', () => {
    const png = plainPng();
    expect(stripImageMetadata(png).equals(png)).toBe(true);
  });

  it('keeps the orientation as a valid eXIf chunk before the image data and drops the rest', () => {
    const exif = pngChunk('eXIf', tiffWithOrientation(8));
    const clean = stripImageMetadata(plainPng([exif, text]));
    expect(contains(clean, 'SecretCam')).toBe(false);
    expect(clean.equals(plainPng([pngChunk('eXIf', orientationTiff(8))]))).toBe(true);
    expect(clean.indexOf('eXIf')).toBeLessThan(clean.indexOf('IDAT'));
  });

  it('drops anything after IEND', () => {
    const png = Buffer.concat([plainPng(), Buffer.from('appended secret data')]);
    expect(stripImageMetadata(png).equals(plainPng())).toBe(true);
  });

  it.each([
    ['a chunk that overruns the file', Buffer.concat([plainPng().subarray(0, 8), Buffer.from([0, 0, 1, 0]), Buffer.from('IHDRxx')])],
    ['a missing IEND', plainPng().subarray(0, plainPng().length - 12)],
    ['IHDR not first', Buffer.concat([plainPng().subarray(0, 8), pngChunk('tEXt', Buffer.from('a\0b'))])],
    ['only the signature', plainPng().subarray(0, 8)],
  ])('rejects %s', (_name, bad) => {
    expect(() => stripImageMetadata(bad)).toThrow(InvalidImageError);
  });
});

describe('stripImageMetadata: WebP structure', () => {
  const vp8x = (flags: number): Buffer => webpChunk('VP8X', Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const image = webpChunk('VP8L', Buffer.from([0x2f, 1, 2, 3, 4]));

  it('drops EXIF and XMP chunks and clears their VP8X flags', () => {
    const file = riffWebp([
      vp8x(0x2c), webpChunk('ICCP', Buffer.from('icc!')), image,
      webpChunk('EXIF', tiffWithOrientation(1)), webpChunk('XMP ', Buffer.from('<x>secret</x>')),
    ]);
    const clean = stripImageMetadata(file);
    expect(contains(clean, 'secret')).toBe(false);
    expect(contains(clean, 'SecretCam')).toBe(false);
    expect(contains(clean, 'EXIF')).toBe(false);
    expect(contains(clean, 'XMP ')).toBe(false);
    // The ICC flag (0x20) stays, EXIF (0x08) and XMP (0x04) are cleared.
    expect(clean[12 + 8]).toBe(0x20);
    expect(contains(clean, 'ICCP')).toBe(true);
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
  });

  it('keeps the orientation in a one-tag EXIF chunk with the EXIF flag set', () => {
    const clean = stripImageMetadata(riffWebp([vp8x(0x08), image, webpChunk('EXIF', tiffWithOrientation(6))]));
    expect(clean.equals(riffWebp([vp8x(0x08), image, webpChunk('EXIF', orientationTiff(6))]))).toBe(true);
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
  });

  it('accepts an EXIF chunk with the Exif header prefix some writers add', () => {
    const prefixed = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffWithOrientation(3)]);
    const clean = stripImageMetadata(riffWebp([vp8x(0x08), image, webpChunk('EXIF', prefixed)]));
    expect(clean.equals(riffWebp([vp8x(0x08), image, webpChunk('EXIF', orientationTiff(3))]))).toBe(true);
  });

  it('leaves a plain lossless WebP byte for byte unchanged and drops trailing bytes', () => {
    const plain = riffWebp([image]);
    expect(stripImageMetadata(plain).equals(plain)).toBe(true);
    expect(stripImageMetadata(Buffer.concat([plain, Buffer.from('trailer secret')])).equals(plain)).toBe(true);
  });

  it('keeps animation chunks', () => {
    const anim = riffWebp([
      vp8x(0x02), webpChunk('ANIM', Buffer.alloc(6)), webpChunk('ANMF', Buffer.alloc(24)), webpChunk('XMP ', Buffer.from('secret')),
    ]);
    const clean = stripImageMetadata(anim);
    expect(contains(clean, 'ANIM')).toBe(true);
    expect(contains(clean, 'ANMF')).toBe(true);
    expect(contains(clean, 'secret')).toBe(false);
  });

  it.each([
    ['a chunk longer than the file', Buffer.concat([riffWebp([image]).subarray(0, 12), Buffer.from('VP8L'), Buffer.from([0xff, 0xff, 0, 0])])],
    ['no image chunk', riffWebp([vp8x(0), webpChunk('XMP ', Buffer.from('x'))])],
    ['RIFF that is not WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WAVE')])],
    ['a short VP8X', riffWebp([webpChunk('VP8X', Buffer.alloc(3)), image])],
  ])('rejects %s', (_name, bad) => {
    expect(() => stripImageMetadata(bad)).toThrow(InvalidImageError);
  });
});

describe('readExifOrientation and sniffImageKind', () => {
  it('returns 1 for anything it cannot trust', () => {
    expect(readExifOrientation(Buffer.alloc(0))).toBe(1);
    expect(readExifOrientation(Buffer.from('not a tiff header at all'))).toBe(1);
    const lyingCount = orientationTiff(6);
    lyingCount.writeUInt16LE(0x0111, 10); // no Orientation tag any more ...
    lyingCount.writeUInt16LE(5000, 8); // ... and a count claiming thousands of entries in a tiny buffer
    expect(readExifOrientation(lyingCount)).toBe(1);
    const farIfd = tiffWithOrientation(6);
    farIfd.writeUInt32LE(0xfffffff0, 4);
    expect(readExifOrientation(farIfd)).toBe(1);
    expect(readExifOrientation(orientationTiff(9))).toBe(1); // out of range
    expect(readExifOrientation(orientationTiff(0))).toBe(1);
  });

  it('recognises the three containers and nothing else', () => {
    expect(sniffImageKind(JPEG_WITH_METADATA)).toBe('jpeg');
    expect(sniffImageKind(plainPng())).toBe('png');
    expect(sniffImageKind(WEBP_WITH_METADATA)).toBe('webp');
    expect(sniffImageKind(Buffer.from('GIF89a'))).toBeNull();
    expect(() => stripImageMetadata(Buffer.from('<svg onload=alert(1)>'))).toThrow(InvalidImageError);
  });
});
