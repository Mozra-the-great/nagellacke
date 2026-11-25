/**
 * #498: the metadata stripper (#451) at its edges. imageMeta.test.ts proves that real files
 * with EXIF, XMP and text come out clean and decodable; this file pins the parser's
 * decisions one byte at a time: which bytes make a file a JPEG, PNG or WebP, which segments
 * and chunks survive, what a truncated or lying length field does (always an
 * InvalidImageError, never a read past the buffer), and what is written back. It is the one
 * module here that parses untrusted bytes, so each comparison and each message is pinned.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidImageError, orientationTiff, pngChunk, readExifOrientation, sniffImageKind, stripImageMetadata, webpChunk,
} from './imageMeta';
import { exifSegment, jpegSegment, plainPng, riffWebp, syntheticJpeg, tiffWithOrientation } from './testImages';

const strip = stripImageMetadata;
const bytes = (...b: number[]): Buffer => Buffer.from(b);
const text = (s: string): Buffer => Buffer.from(s, 'latin1');
const refusal = (buf: Buffer): string => {
  try { strip(buf); } catch (e) { expect(e).toBeInstanceOf(InvalidImageError); return (e as Error).message; }
  return '';
};

const SOI = bytes(0xff, 0xd8);
const SOF = jpegSegment(0xc0, bytes(8, 0, 1, 0, 1, 1, 1, 0x11, 0));
const SOS = jpegSegment(0xda, bytes(1, 1, 0, 0, 63, 0));
const EOI = bytes(0xff, 0xd9);
/** SOI, the given parts, then a minimal frame and scan (with the given entropy-coded bytes) and EOI. */
const jpeg = (parts: Buffer[], scan: Buffer = bytes(0x12, 0x34), tail: Buffer = EOI): Buffer => Buffer.concat([SOI, ...parts, SOF, SOS, scan, tail]);

describe('InvalidImageError', () => {
  it('is an Error with its own name', () => {
    const e = new InvalidImageError('why');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('InvalidImageError');
    expect(e.message).toBe('why');
  });
});

describe('sniffImageKind, byte by byte', () => {
  it.each<[string, Buffer, string | null]>([
    ['a JPEG start', bytes(0xff, 0xd8, 0xff), 'jpeg'],
    ['a JPEG start with more bytes', bytes(0xff, 0xd8, 0xff, 0xe0, 1), 'jpeg'],
    ['two bytes of a JPEG', bytes(0xff, 0xd8), null],
    ['a wrong first JPEG byte', bytes(0x00, 0xd8, 0xff), null],
    ['a wrong second JPEG byte', bytes(0xff, 0xd9, 0xff), null],
    ['a wrong third JPEG byte', bytes(0xff, 0xd8, 0xfe), null],
    ['exactly the four PNG bytes', bytes(0x89, 0x50, 0x4e, 0x47), 'png'],
    ['a PNG start with more bytes', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), 'png'],
    ['three bytes of a PNG', bytes(0x89, 0x50, 0x4e), null],
    ['a wrong first PNG byte', bytes(0x88, 0x50, 0x4e, 0x47), null],
    ['a wrong second PNG byte', bytes(0x89, 0x51, 0x4e, 0x47), null],
    ['a wrong third PNG byte', bytes(0x89, 0x50, 0x4f, 0x47), null],
    ['a wrong fourth PNG byte', bytes(0x89, 0x50, 0x4e, 0x46), null],
    ['exactly RIFF', text('RIFF'), 'webp'],
    ['RIFF and more', text('RIFF....WEBP'), 'webp'],
    ['RIF', text('RIF'), null],
    ['RIFX', text('RIFX'), null],
    ['lower-case riff', text('riff'), null],
    ['nothing', Buffer.alloc(0), null],
    ['text', text('hello world'), null],
  ])('%s', (_name, buf, kind) => {
    expect(sniffImageKind(buf)).toBe(kind);
  });

  it('refuses everything else with a message that says why', () => {
    expect(refusal(text('hello world'))).toBe('unsupported image format');
    expect(refusal(Buffer.alloc(0))).toBe('unsupported image format');
  });
});

describe('JPEG: what is refused', () => {
  it('refuses a start that is too short to hold a segment', () => {
    expect(refusal(bytes(0xff, 0xd8, 0xff))).toBe('not a JPEG');
  });

  it('refuses a byte that is not a marker where one has to be', () => {
    expect(refusal(Buffer.concat([SOI, jpegSegment(0xfe, Buffer.alloc(0)), bytes(0x12, 0x34)]))).toBe('JPEG: expected a marker');
  });

  it('refuses a file with no scan', () => {
    expect(refusal(Buffer.concat([SOI, SOF]))).toBe('JPEG: no image data');
    expect(refusal(bytes(0xff, 0xd8, 0xff, 0xff))).toBe('JPEG: no image data'); // only fill bytes
    expect(refusal(Buffer.concat([SOI, SOF, EOI]))).toBe('JPEG: no image data');
  });

  it('refuses a segment whose header is cut off, and accepts one that ends exactly at the end', () => {
    expect(refusal(bytes(0xff, 0xd8, 0xff, 0xe1, 0x00))).toBe('JPEG: truncated segment header');
    expect(refusal(bytes(0xff, 0xd8, 0xff, 0xe1))).toBe('JPEG: truncated segment header');
    // a header that fits exactly is not "truncated" - the file just has no scan
    expect(refusal(Buffer.concat([SOI, jpegSegment(0xfe, Buffer.alloc(0))]))).toBe('JPEG: no image data');
  });

  it('refuses a length that is below 2 or runs past the end, and accepts one that fits exactly', () => {
    const lengthOnly = (len: number, extra = 0): Buffer => Buffer.concat([SOI, bytes(0xff, 0xfe, len >> 8, len & 255), Buffer.alloc(extra)]);
    expect(refusal(lengthOnly(0))).toBe('JPEG: bad segment length');
    expect(refusal(lengthOnly(1, 4))).toBe('JPEG: bad segment length');
    expect(refusal(lengthOnly(3, 0))).toBe('JPEG: bad segment length'); // one payload byte missing
    expect(refusal(lengthOnly(10, 7))).toBe('JPEG: bad segment length'); // one byte short
    expect(refusal(lengthOnly(10, 8))).toBe('JPEG: no image data'); // fits exactly
    expect(refusal(lengthOnly(2))).toBe('JPEG: no image data'); // the smallest legal length
  });
});

describe('JPEG: what is kept, and where', () => {
  // The expectation is built from the parts, not by running the stripper on them.
  const plain = jpeg([]);

  it('skips fill bytes in front of a marker', () => {
    const filled = Buffer.concat([SOI, bytes(0xff, 0xff, 0xff), SOF, SOS, bytes(0x12, 0x34), EOI]);
    expect(strip(filled).equals(plain)).toBe(true);
  });

  it.each([0x01, 0xd0, 0xd3, 0xd7])('keeps the standalone marker 0x%s in place, without reading a length after it', (m) => {
    const out = strip(jpeg([bytes(0xff, m)]));
    expect(out.equals(Buffer.concat([SOI, bytes(0xff, m), plain.subarray(2)]))).toBe(true);
  });

  it.each([0xcf, 0xd8])('treats 0x%s as an ordinary segment with a length, not a standalone marker', (m) => {
    const seg = jpegSegment(m, bytes(7, 7));
    expect(strip(jpeg([seg])).equals(Buffer.concat([SOI, seg, plain.subarray(2)]))).toBe(true);
  });

  it('keeps APP0 only as a JFIF header of at least 18 bytes, with its thumbnail cut off', () => {
    const jfifPayload = (n: number): Buffer => Buffer.concat([text('JFIF\0'), Buffer.from([1, 2, 1, 0, 72, 0, 72, 3, 3]), Buffer.alloc(n)]);
    // 14 payload bytes = a 18 byte segment: kept, thumbnail size zeroed, length rewritten to 16
    const kept = strip(jpeg([jpegSegment(0xe0, jfifPayload(0))]));
    const at = kept.indexOf(text('JFIF\0'));
    expect(kept.readUInt16BE(at - 2)).toBe(16);
    expect([kept[at + 12], kept[at + 13]]).toEqual([0, 0]);
    expect(kept.length).toBe(plain.length + 18);
    // 13 payload bytes = a 17 byte segment: too short to be a JFIF header, dropped
    const short = jpegSegment(0xe0, jfifPayload(0).subarray(0, 13));
    expect(strip(jpeg([short])).equals(plain)).toBe(true);
    // not JFIF at all
    expect(strip(jpeg([jpegSegment(0xe0, Buffer.concat([text('JFXX\0'), Buffer.alloc(20)]))])).equals(plain)).toBe(true);
    expect(strip(jpeg([jpegSegment(0xe0, Buffer.concat([text('JFIFX'), Buffer.alloc(20)]))])).equals(plain)).toBe(true);
  });

  it('reads the orientation only from an APP1 that starts with the exact Exif header', () => {
    const tiff = orientationTiff(6);
    const marked = strip(jpeg([exifSegment(tiff)]));
    expect(marked.indexOf(orientationTiff(6))).toBeGreaterThan(0);
    for (const prefix of ['Exif\0X', 'Exif\0', 'Exiff\0', 'http://ns.adobe.com/xap/1.0/\0']) {
      expect(strip(jpeg([jpegSegment(0xe1, Buffer.concat([text(prefix), tiff]))])).equals(plain)).toBe(true);
    }
    // another marker with an Exif header is just dropped, its orientation not used
    expect(strip(jpeg([jpegSegment(0xe2, Buffer.concat([text('Exif\0\0'), tiff]))])).equals(plain)).toBe(true);
  });

  it('keeps an ICC profile in APP2 and an Adobe marker in APP14, each only with its own header', () => {
    const icc = jpegSegment(0xe2, Buffer.concat([text('ICC_PROFILE\0'), bytes(1, 1, 9)]));
    const adobe = jpegSegment(0xee, text('Adobe\0\0\0\0\0\0\0'));
    expect(strip(jpeg([icc, adobe])).equals(Buffer.concat([SOI, icc, adobe, plain.subarray(2)]))).toBe(true);
    // a segment that is nothing but the header is still that header
    const bareIcc = jpegSegment(0xe2, text('ICC_PROFILE\0'));
    const bareAdobe = jpegSegment(0xee, text('Adobe'));
    expect(strip(jpeg([bareIcc, bareAdobe])).equals(Buffer.concat([SOI, bareIcc, bareAdobe, plain.subarray(2)]))).toBe(true);
    for (const seg of [
      jpegSegment(0xe2, Buffer.concat([text('ICC_PROFILX\0'), bytes(1, 1, 9)])),
      jpegSegment(0xe2, text('MPF\0')),
      jpegSegment(0xee, text('Adobx\0\0\0\0\0\0\0')),
      jpegSegment(0xee, Buffer.concat([text('ICC_PROFILE\0'), bytes(1, 1, 9)])),
      jpegSegment(0xe2, text('Adobe\0\0\0\0\0\0\0')),
      jpegSegment(0xee, text('Ado')),
    ]) {
      expect(strip(jpeg([seg])).equals(plain)).toBe(true);
    }
  });

  it('drops APP1-APP15 and COM, and keeps everything just outside that range', () => {
    for (let m = 0xe1; m <= 0xef; m += 1) {
      if (m === 0xe2 || m === 0xee) continue; // kept only with their headers, above
      expect(strip(jpeg([jpegSegment(m, text('secret'))])).equals(plain), `0x${m.toString(16)}`).toBe(true);
    }
    expect(strip(jpeg([jpegSegment(0xfe, text('secret'))])).equals(plain)).toBe(true);
    for (const m of [0xdb, 0xdf, 0xf0, 0xfd, 0xff - 1 - 1]) {
      if (m === 0xfc) continue;
      const seg = jpegSegment(m, bytes(1, 2, 3));
      expect(strip(jpeg([seg])).equals(Buffer.concat([SOI, seg, plain.subarray(2)])), `0x${m.toString(16)}`).toBe(true);
    }
  });

  it('writes the orientation block once, right before the first kept non-JFIF segment', () => {
    const jfif = jpegSegment(0xe0, Buffer.concat([text('JFIF\0'), Buffer.from([1, 2, 1, 0, 72, 0, 72, 0, 0])]));
    const dqt = jpegSegment(0xdb, bytes(0, 1, 2, 3));
    const dht = jpegSegment(0xc4, bytes(0, 1, 2, 3));
    const out = strip(jpeg([jfif, exifSegment(tiffWithOrientation(8)), dqt, dht]));
    const exifAt = out.indexOf(text('Exif\0\0'));
    expect(out.indexOf(dqt)).toBeGreaterThan(exifAt);
    expect(exifAt).toBeGreaterThan(out.indexOf(text('JFIF\0')));
    expect(out.indexOf(text('Exif\0\0'), exifAt + 1)).toBe(-1); // exactly one
    const block = out.subarray(exifAt - 4, exifAt + 6 + 26);
    expect(block.readUInt16BE(0)).toBe(0xffe1);
    expect(block.readUInt16BE(2)).toBe(2 + 6 + 26);
    expect(readExifOrientation(block.subarray(10))).toBe(8);
  });

  it('writes no orientation block for "as stored" and for a value outside 2-8', () => {
    for (const o of [1, 0, 9, 255]) expect(strip(jpeg([exifSegment(tiffWithOrientation(o))])).equals(plain), String(o)).toBe(true);
    for (const o of [2, 3, 4, 5, 6, 7, 8]) expect(strip(jpeg([exifSegment(tiffWithOrientation(o))])).includes(orientationTiff(o)), String(o)).toBe(true);
  });
});

describe('JPEG: the scan', () => {
  const frame = Buffer.concat([SOI, SOF, SOS]);

  it('copies entropy-coded data up to the next real marker, treating stuffing and restart markers as data', () => {
    const scan = bytes(0x01, 0xff, 0x00, 0x02, 0xff, 0xd0, 0x03, 0xff, 0xd7, 0x04);
    const out = strip(Buffer.concat([frame, scan, EOI]));
    expect(out.equals(Buffer.concat([frame, scan, EOI]))).toBe(true);
  });

  it('ends the scan at a marker next to a fill byte', () => {
    const out = strip(Buffer.concat([frame, bytes(0x11, 0xff, 0xff, 0xd9, 0x77, 0x77)]));
    expect(out.equals(Buffer.concat([frame, bytes(0x11, 0xff), EOI]))).toBe(true);
  });

  it('does not take 0xD8 or 0xCF after an 0xFF in a scan for a restart marker', () => {
    // 0xFF m starts a segment with a length (8: itself plus six bytes), and what is inside it is not walked:
    // a COM marker in there is part of the segment, not a segment of its own.
    for (const m of [0xd8, 0xcf]) {
      const input = Buffer.concat([frame, bytes(0x11, 0xff, m, 0x00, 0x08, 0xff, 0xfe, 0x00, 0x04, 0xaa, 0xbb), EOI]);
      expect(strip(input).equals(input), m.toString(16)).toBe(true);
    }
  });

  it('takes a scan that runs to the end of the file, with or without a lone 0xFF at the very end', () => {
    expect(strip(Buffer.concat([frame, bytes(0x12, 0x34)])).equals(Buffer.concat([frame, bytes(0x12, 0x34)]))).toBe(true);
    expect(strip(Buffer.concat([frame, bytes(0x12, 0xff)])).equals(Buffer.concat([frame, bytes(0x12, 0xff)]))).toBe(true);
    expect(strip(frame).equals(frame)).toBe(true); // an empty scan
  });

  it('stops the scan at the first byte pair that is a marker, and keeps several scans', () => {
    const sos2 = jpegSegment(0xda, bytes(1, 1, 0, 0, 63, 0));
    const input = Buffer.concat([frame, bytes(0xaa, 0xbb), sos2, bytes(0xcc), EOI]);
    expect(strip(input).equals(input)).toBe(true);
  });
});

describe('PNG: what is refused', () => {
  const sig = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = pngChunk('IHDR', Buffer.alloc(13));
  const idat = pngChunk('IDAT', bytes(1, 2, 3));
  const iend = pngChunk('IEND', Buffer.alloc(0));

  it('refuses a start that is not the full signature', () => {
    expect(refusal(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('not a PNG');
    expect(refusal(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBe('not a PNG'); // seven bytes
    expect(refusal(Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b), ihdr, idat, iend]))).toBe('not a PNG');
    expect(refusal(Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0a, 0x0d, 0x1a, 0x0a), ihdr, idat, iend]))).toBe('not a PNG');
  });

  it('refuses a chunk that is cut off, and one whose length runs past the end, to the byte', () => {
    expect(refusal(Buffer.concat([sig, ihdr.subarray(0, 11)]))).toBe('PNG: truncated chunk');
    const bad = Buffer.from(ihdr);
    bad.writeUInt32BE(14, 0); // the chunk claims one byte more than there is
    expect(refusal(Buffer.concat([sig, bad]))).toBe('PNG: bad chunk length');
    const huge = Buffer.from(ihdr);
    huge.writeUInt32BE(0xffffffff, 0);
    expect(refusal(Buffer.concat([sig, huge]))).toBe('PNG: bad chunk length');
    // a chunk that fits to the byte is read, so the failure is a later one
    expect(refusal(Buffer.concat([sig, ihdr]))).toBe('PNG: incomplete');
    expect(refusal(Buffer.concat([sig, pngChunk('IHDR', Buffer.alloc(0))]))).toBe('PNG: incomplete');
  });

  it('refuses a file whose first chunk is not IHDR, whatever it is', () => {
    expect(refusal(Buffer.concat([sig, idat, ihdr, iend]))).toBe('PNG: IHDR must come first');
    expect(refusal(Buffer.concat([sig, iend]))).toBe('PNG: IHDR must come first');
    expect(refusal(Buffer.concat([sig, pngChunk('tEXt', text('a\0b')), ihdr, idat, iend]))).toBe('PNG: IHDR must come first');
  });

  it('refuses a file that lacks the header, the image data or the end, with one message', () => {
    expect(refusal(sig)).toBe('PNG: incomplete');
    expect(refusal(Buffer.concat([sig, ihdr, iend]))).toBe('PNG: incomplete'); // no IDAT
    expect(refusal(Buffer.concat([sig, ihdr, idat]))).toBe('PNG: incomplete'); // no IEND
    expect(refusal(Buffer.concat([sig, ihdr]))).toBe('PNG: incomplete');
    expect(strip(Buffer.concat([sig, ihdr, idat, iend])).length).toBe(sig.length + ihdr.length + idat.length + iend.length);
  });
});

describe('PNG: what is kept', () => {
  const KEPT = ['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'hIST', 'pHYs', 'cICP', 'mDCV', 'cLLI', 'acTL', 'fcTL', 'fdAT'];
  const DROPPED = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'sPLT', 'prVW', 'orNT', 'caBX', 'XMP '];

  it.each(KEPT)('keeps a %s chunk', (type) => {
    const chunk = pngChunk(type, bytes(1, 2, 3, 4));
    const out = strip(plainPng([chunk]));
    expect(out.includes(chunk)).toBe(true);
    expect(out.equals(plainPng([chunk]))).toBe(true);
  });

  it.each(DROPPED)('drops a %s chunk', (type) => {
    const out = strip(plainPng([pngChunk(type, text('secret-data'))]));
    expect(out.includes(text('secret-data'))).toBe(false);
    expect(out.equals(plainPng())).toBe(true);
  });

  it('writes one eXIf chunk before the first IDAT however many IDATs follow, and none for "as stored"', () => {
    const idat2 = pngChunk('IDAT', bytes(9, 9));
    const sig = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const base = plainPng();
    const iendAt = base.length - 12;
    const withTwoIdats = Buffer.concat([base.subarray(0, iendAt), idat2, base.subarray(iendAt)]);
    const ihdrEnd = sig.length + 12 + 13;
    const withOrientation = Buffer.concat([withTwoIdats.subarray(0, ihdrEnd), pngChunk('eXIf', tiffWithOrientation(3)), withTwoIdats.subarray(ihdrEnd)]);
    const out = strip(withOrientation);
    const exif = pngChunk('eXIf', orientationTiff(3));
    expect(out.indexOf(exif)).toBeGreaterThan(0);
    expect(out.indexOf(exif, out.indexOf(exif) + 1)).toBe(-1);
    expect(out.indexOf(exif)).toBeLessThan(out.indexOf(text('IDAT')));
    expect(out.includes(idat2)).toBe(true);
    // value 1: nothing is written
    const plainOrientation = Buffer.concat([withTwoIdats.subarray(0, ihdrEnd), pngChunk('eXIf', tiffWithOrientation(1)), withTwoIdats.subarray(ihdrEnd)]);
    expect(strip(plainOrientation).equals(withTwoIdats)).toBe(true);
  });

  it('puts the orientation chunk in front of IDAT but not in front of the chunks before it', () => {
    const out = strip(Buffer.concat([
      plainPng().subarray(0, 8 + 25), pngChunk('eXIf', tiffWithOrientation(6)), pngChunk('PLTE', bytes(1, 2, 3)),
      plainPng().subarray(8 + 25),
    ]));
    expect(out.indexOf(text('PLTE'))).toBeLessThan(out.indexOf(text('eXIf')));
    expect(out.indexOf(text('eXIf'))).toBeLessThan(out.indexOf(text('IDAT')));
  });
});

describe('WebP: what is refused', () => {
  const vp8 = webpChunk('VP8 ', bytes(1, 2, 3, 4));
  const riff = (type: string, body: Buffer, size = 4 + body.length): Buffer => {
    const head = Buffer.alloc(12);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(size, 4);
    head.write(type, 8, 'latin1');
    return Buffer.concat([head, body]);
  };

  it('refuses a RIFF that is not WebP, or too short to say', () => {
    expect(refusal(text('RIFF'))).toBe('not a WebP');
    expect(refusal(text('RIFF\0\0\0\0WEB'))).toBe('not a WebP'); // eleven bytes
    expect(refusal(riff('WAVE', vp8))).toBe('not a WebP');
    expect(refusal(riff('WEBX', vp8))).toBe('not a WebP');
  });

  it('refuses a file without image data, also when only side chunks are there', () => {
    expect(refusal(riff('WEBP', Buffer.alloc(0)))).toBe('WebP: no image data');
    expect(refusal(riff('WEBP', Buffer.concat([webpChunk('VP8X', Buffer.alloc(10)), webpChunk('ALPH', bytes(1)), webpChunk('ICCP', bytes(1, 2))])))).toBe('WebP: no image data');
    expect(refusal(riff('WEBP', Buffer.concat([webpChunk('EXIF', orientationTiff(6)), webpChunk('XMP ', text('x'))])))).toBe('WebP: no image data');
  });

  it('accepts each image chunk as image data', () => {
    for (const fourcc of ['VP8 ', 'VP8L', 'ANMF']) {
      expect(refusal(riff('WEBP', webpChunk(fourcc, bytes(1, 2, 3, 4)))), fourcc).toBe('');
    }
  });

  it('refuses a chunk whose size runs past the end, to the byte, and reads one that fits exactly', () => {
    const exact = riff('WEBP', vp8);
    expect(strip(exact).equals(exact)).toBe(true);
    const lying = Buffer.from(exact);
    lying.writeUInt32LE(5, 16); // the VP8 chunk claims one payload byte more than the file holds
    expect(refusal(lying)).toBe('WebP: bad chunk length');
    const odd = riff('WEBP', Buffer.concat([text('VP8 '), bytes(5, 0, 0, 0), bytes(1, 2, 3, 4, 5)])); // odd size and no pad byte at the very end
    expect(refusal(odd)).toBe('');
    const huge = Buffer.from(exact);
    huge.writeUInt32LE(0xffffffff, 16);
    expect(refusal(huge)).toBe('WebP: bad chunk length');
  });

  it('reads a chunk header that ends exactly at the end of the declared size', () => {
    const empty = riff('WEBP', Buffer.concat([vp8, text('VP8L'), bytes(0, 0, 0, 0)]));
    expect(strip(empty).equals(riff('WEBP', Buffer.concat([vp8, text('VP8L'), bytes(0, 0, 0, 0)])))).toBe(true);
    const onlyEmptyImage = riff('WEBP', Buffer.concat([text('VP8 '), bytes(0, 0, 0, 0)]));
    expect(refusal(onlyEmptyImage)).toBe(''); // a zero-size image chunk at the very end still counts as image data
  });

  it('refuses an extended-format header that is too short, and takes one of ten bytes', () => {
    expect(refusal(riff('WEBP', Buffer.concat([webpChunk('VP8X', Buffer.alloc(9)), vp8])))).toBe('WebP: bad VP8X chunk');
    expect(refusal(riff('WEBP', Buffer.concat([webpChunk('VP8X', Buffer.alloc(10)), vp8])))).toBe('');
  });

  it('ignores whatever lies past the size the RIFF header declares', () => {
    const exact = riff('WEBP', vp8);
    const withTrailer = Buffer.concat([exact, webpChunk('EXIF', text('trailing-secret')), webpChunk('VP8X', Buffer.alloc(3))]);
    expect(strip(withTrailer).equals(exact)).toBe(true);
    const short = riff('WEBP', Buffer.concat([vp8, webpChunk('JUNK', bytes(1, 2))]), 4 + vp8.length);
    expect(strip(short).equals(exact)).toBe(true);
  });
});

describe('WebP: what is kept', () => {
  const vp8 = webpChunk('VP8 ', bytes(1, 2, 3, 4));
  const vp8x = (flags: number): Buffer => webpChunk('VP8X', Buffer.concat([bytes(flags, 0, 0, 0), Buffer.alloc(6)]));
  const file = (...chunks: Buffer[]): Buffer => riffWebp(chunks);

  it.each(['ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8L'])('keeps a %s chunk, in place', (fourcc) => {
    const chunk = webpChunk(fourcc, bytes(1, 2, 3, 4, 5, 6));
    const input = file(vp8x(0), chunk, vp8);
    expect(strip(input).equals(input)).toBe(true);
  });

  it.each(['XMP ', 'JUNK', 'abcd', 'EXIF'])('drops a %s chunk', (fourcc) => {
    const out = strip(file(vp8x(0), webpChunk(fourcc, text('secret-data')), vp8));
    expect(out.includes(text('secret-data'))).toBe(false);
    expect(out.equals(file(vp8x(0), vp8))).toBe(true);
  });

  it('keeps odd-sized chunks and their pad byte so the chunks after them are still found', () => {
    const odd = webpChunk('ICCP', bytes(1, 2, 3));
    const input = file(vp8x(0), odd, vp8);
    expect(strip(input).equals(input)).toBe(true);
    expect(webpChunk('ICCP', bytes(1, 2, 3)).length).toBe(8 + 4);
    expect(webpChunk('ICCP', bytes(1, 2)).length).toBe(8 + 2);
  });

  it('clears the EXIF and XMP flags and nothing else, and sets the EXIF flag only for a kept orientation', () => {
    const flagsOf = (buf: Buffer): number => buf[12 + 8];
    expect(flagsOf(strip(file(vp8x(0xff), vp8)))).toBe(0xf3);
    expect(flagsOf(strip(file(vp8x(0x0c), vp8)))).toBe(0x00);
    expect(flagsOf(strip(file(vp8x(0x10), vp8)))).toBe(0x10);
    expect(flagsOf(strip(file(vp8x(0xff), webpChunk('EXIF', tiffWithOrientation(6)), vp8)))).toBe(0xfb);
    expect(flagsOf(strip(file(vp8x(0xff), webpChunk('EXIF', tiffWithOrientation(1)), vp8)))).toBe(0xf3);
  });

  it('writes the orientation as the last chunk, once, in a one-tag EXIF chunk, with the header sizes right', () => {
    const out = strip(file(vp8x(0), webpChunk('EXIF', tiffWithOrientation(6)), vp8));
    const exif = webpChunk('EXIF', orientationTiff(6));
    expect(out.subarray(out.length - exif.length).equals(exif)).toBe(true);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out.toString('latin1', 0, 4)).toBe('RIFF');
    expect(out.toString('latin1', 8, 12)).toBe('WEBP');
  });

  it('reads the orientation from an EXIF chunk with or without the Exif header, and not from a lookalike', () => {
    const tiff = orientationTiff(3);
    const expected = webpChunk('EXIF', tiff);
    for (const payload of [tiff, Buffer.concat([text('Exif\0\0'), tiff])]) {
      const out = strip(file(vp8x(0), webpChunk('EXIF', payload), vp8));
      expect(out.subarray(out.length - expected.length).equals(expected)).toBe(true);
    }
    const lookalike = strip(file(vp8x(0), webpChunk('EXIF', Buffer.concat([text('Exif\0X'), tiff])), vp8));
    expect(lookalike.equals(file(vp8x(0), vp8))).toBe(true);
    expect(strip(file(vp8x(0), webpChunk('EXIF', text('Exif\0\0')), vp8)).equals(file(vp8x(0), vp8))).toBe(true);
  });

  it('leaves a simple file with no VP8X without one, even if it carried EXIF', () => {
    const out = strip(file(webpChunk('EXIF', tiffWithOrientation(6)), vp8));
    expect(out.equals(file(vp8))).toBe(true);
  });
});

describe('readExifOrientation, field by field', () => {
  type Entry = { tag?: number; type?: number; count?: number; value?: number };
  /** A TIFF structure with the given IFD entries, in the given byte order. */
  function tiff(opts: { order?: 'II' | 'MM'; magic?: number; ifd?: number; entries?: Entry[]; count?: number; pad?: number } = {}): Buffer {
    const order = opts.order ?? 'II';
    const le = order === 'II';
    const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); if (le) b.writeUInt16LE(n); else b.writeUInt16BE(n); return b; };
    const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); if (le) b.writeUInt32LE(n); else b.writeUInt32BE(n); return b; };
    const entries = opts.entries ?? [{ tag: 0x0112, type: 3, count: 1, value: 6 }];
    const body = entries.map((e) => Buffer.concat([u16(e.tag ?? 0x0112), u16(e.type ?? 3), u32(e.count ?? 1), u16(e.value ?? 6), u16(0)]));
    return Buffer.concat([text(order), u16(opts.magic ?? 42), u32(opts.ifd ?? 8), u16(opts.count ?? entries.length), ...body, u32(0), Buffer.alloc(opts.pad ?? 0)]);
  }

  it('reads a value from either byte order', () => {
    expect(readExifOrientation(tiff({ order: 'II' }))).toBe(6);
    expect(readExifOrientation(tiff({ order: 'MM' }))).toBe(6);
    expect(readExifOrientation(tiffWithOrientation(3, 'MM'))).toBe(3);
  });

  it('returns each value from 2 to 8 and "as stored" for the rest', () => {
    for (let v = 0; v <= 12; v += 1) {
      expect(readExifOrientation(tiff({ entries: [{ value: v }] })), `value ${v}`).toBe(v >= 2 && v <= 8 ? v : 1);
    }
  });

  it('does not trust a structure that is too short or has no valid byte-order mark', () => {
    expect(readExifOrientation(Buffer.alloc(0))).toBe(1);
    expect(readExifOrientation(tiff().subarray(0, 7))).toBe(1);
    expect(readExifOrientation(tiff().subarray(0, 8))).toBe(1);
    for (const order of ['XX', 'IM', 'MI', 'ii', 'mm', '\0\0']) {
      for (const real of ['II', 'MM'] as const) {
        const t = tiff({ order: real }); // a valid structure in either byte order, with only the mark spoiled
        t.write(order, 0, 'latin1');
        expect(readExifOrientation(t), `${order} over ${real}`).toBe(1);
      }
    }
  });

  it('wants the TIFF magic number 42 in the stated byte order', () => {
    expect(readExifOrientation(tiff({ magic: 43 }))).toBe(1);
    expect(readExifOrientation(tiff({ magic: 0 }))).toBe(1);
    const t = tiff({ order: 'MM' });
    t.writeUInt16LE(42, 2); // 42 in the other byte order
    expect(readExifOrientation(t)).toBe(1);
  });

  it('wants the first IFD inside the structure and behind the header', () => {
    expect(readExifOrientation(tiff({ ifd: 7 }))).toBe(1);
    expect(readExifOrientation(tiff({ ifd: 0 }))).toBe(1);
    expect(readExifOrientation(tiff({ ifd: 0xffffffff }))).toBe(1);
    const t = tiff();
    expect(readExifOrientation(tiff({ ifd: t.length }))).toBe(1); // points to the end
    expect(readExifOrientation(tiff({ ifd: t.length - 1 }))).toBe(1); // no room for the entry count
    // an IFD at offset 8 that has an entry reads it, and so does one moved further in
    const moved = tiff({ ifd: 10 });
    const shifted = Buffer.concat([moved.subarray(0, 8), Buffer.alloc(2), moved.subarray(8)]);
    expect(readExifOrientation(shifted)).toBe(6);
  });

  it('does not read an IFD that starts inside the 8-byte header, even when the bytes there happen to look like one', () => {
    // IFD pointer 7: the entry count would be read from the last pointer byte and the first count byte,
    // and the entry right behind them is a perfectly good Orientation.
    const crafted = Buffer.concat([
      text('II'), bytes(0x2a, 0x00), bytes(0x07, 0x00, 0x00, 0x00), // header with IFD offset 7
      bytes(0x01), // second byte of the "count": 256 entries
      bytes(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00), // Orientation = 6
      Buffer.alloc(8),
    ]);
    expect(readExifOrientation(crafted)).toBe(1);
    // the same entry behind a proper IFD pointer is read
    const proper = Buffer.concat([text('II'), bytes(0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00), bytes(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00), Buffer.alloc(4)]);
    expect(readExifOrientation(proper)).toBe(6);
  });

  it('finds the orientation among other entries and returns the first one it meets', () => {
    expect(readExifOrientation(tiff({ entries: [{ tag: 0x010f, type: 2, count: 10, value: 0 }, { value: 4 }, { value: 8 }] }))).toBe(4);
    expect(readExifOrientation(tiff({ entries: [{ tag: 0x0111 }, { tag: 0x0113 }] }))).toBe(1); // none of them
    expect(readExifOrientation(tiff({ entries: [{ tag: 0x0111 }, { value: 5 }], count: 1 }))).toBe(1); // not within the declared count
    expect(readExifOrientation(tiff({ entries: [{ tag: 0x0111 }, { value: 5 }], count: 2 }))).toBe(5);
  });

  it('stops at an entry that would run past the end instead of reading it', () => {
    const t = tiff({ entries: [{ tag: 0x0111 }, { value: 5 }], count: 2 });
    const entryAt = (i: number): number => 8 + 2 + i * 12;
    expect(readExifOrientation(t.subarray(0, entryAt(1) + 12))).toBe(5); // the last entry ends exactly at the end
    expect(readExifOrientation(t.subarray(0, entryAt(1) + 11))).toBe(1); // one byte short
    expect(readExifOrientation(tiff({ count: 2 }))).toBe(6); // the first entry is found before the missing second one matters
    expect(readExifOrientation(tiff({ entries: [{ tag: 0x0111 }], count: 3, pad: 0 }))).toBe(1);
  });

  it('wants a SHORT with a count of one', () => {
    expect(readExifOrientation(tiff({ entries: [{ type: 3, count: 1, value: 6 }] }))).toBe(6);
    expect(readExifOrientation(tiff({ entries: [{ type: 4 }] }))).toBe(1);
    expect(readExifOrientation(tiff({ entries: [{ type: 2 }] }))).toBe(1);
    expect(readExifOrientation(tiff({ entries: [{ type: 0 }] }))).toBe(1);
    expect(readExifOrientation(tiff({ entries: [{ count: 2 }] }))).toBe(1);
    expect(readExifOrientation(tiff({ entries: [{ count: 0 }] }))).toBe(1);
  });

  it('does not go on to look at a later orientation entry once the first one is not usable', () => {
    expect(readExifOrientation(tiff({ entries: [{ type: 4 }, { value: 5 }] }))).toBe(1);
  });

  it('builds the one-tag structure it writes back: 26 bytes, little-endian, the value where a reader expects it', () => {
    const t = orientationTiff(7);
    expect(t.length).toBe(26);
    expect(t.subarray(0, 8)).toEqual(bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00));
    expect(t.subarray(8, 10)).toEqual(bytes(0x01, 0x00));
    expect(t.subarray(10, 22)).toEqual(bytes(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 7, 0x00, 0x00, 0x00));
    expect(t.subarray(22)).toEqual(bytes(0, 0, 0, 0));
    expect(readExifOrientation(t)).toBe(7);
  });
});

describe('the chunk builders the tests and the stripper share', () => {
  it('writes a PNG chunk with its length, type and a CRC that matches the known value', () => {
    const iend = pngChunk('IEND', Buffer.alloc(0));
    expect(iend.equals(bytes(0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82))).toBe(true); // the CRC every PNG ends with
    const text5 = pngChunk('tEXt', text('hello'));
    expect(text5.readUInt32BE(0)).toBe(5);
    expect(text5.toString('latin1', 4, 8)).toBe('tEXt');
    expect(text5.subarray(8, 13).toString('latin1')).toBe('hello');
    expect(text5.length).toBe(12 + 5);
  });

  it('writes a RIFF chunk with a little-endian size and a pad byte for an odd size only', () => {
    const odd = webpChunk('JUNK', bytes(1, 2, 3));
    expect([...odd]).toEqual([...text('JUNK'), 3, 0, 0, 0, 1, 2, 3, 0]);
    const even = webpChunk('JUNK', bytes(1, 2));
    expect([...even]).toEqual([...text('JUNK'), 2, 0, 0, 0, 1, 2]);
    expect(webpChunk('JUNK', Buffer.alloc(0)).length).toBe(8);
  });
});

describe('a few whole files', () => {
  it('passes a clean synthetic JPEG through unchanged', () => {
    const clean = syntheticJpeg([]);
    expect(strip(clean).equals(clean)).toBe(true);
  });
});
