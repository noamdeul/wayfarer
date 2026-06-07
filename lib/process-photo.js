'use strict';

const exifr = require('exifr');
const heicConvert = require('heic-convert');

const HEIC_EXTENSIONS = ['.heic', '.heif'];
// ISO base-media-file-format brands that indicate HEIF/HEIC payloads.
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'];

function hasHeicExtension(filename) {
  const lower = (filename || '').toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Decide whether a buffer is a HEIC/HEIF image. We look at the filename, the
 * declared mime type, and finally sniff the `ftyp` box brand from the bytes so
 * we still catch files with a misleading name or a generic mime type.
 */
function isHeic(filename, mimetype, buffer) {
  if (hasHeicExtension(filename)) return true;
  if (mimetype && /hei[cf]|heif|heic/i.test(mimetype)) return true;
  if (buffer && buffer.length >= 12) {
    // The major brand lives at bytes 8..12, right after the box size + "ftyp".
    const boxType = buffer.toString('ascii', 4, 8);
    if (boxType === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12).toLowerCase();
      if (HEIF_BRANDS.includes(brand)) return true;
    }
  }
  return false;
}

/**
 * Sniff a raster image format from the leading "magic" bytes. Returns a mime
 * type for recognised formats, or null when the bytes don't look like any
 * image we can hand to the browser. This is how we catch "can't be read at
 * all" files (a .jpg that's really text, a truncated header, etc.).
 */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'image/tiff';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Read GPS coordinates from the ORIGINAL image. `input` may be a Buffer or a
 * file path — exifr reads only the metadata bytes either way. This must happen
 * before any conversion, because converting HEIC -> JPEG strips the EXIF.
 * Returns { lat, lng } or null when no usable location is present.
 */
async function readGps(input) {
  try {
    const gps = await exifr.gps(input);
    if (!gps) return null;
    const { latitude: lat, longitude: lng } = gps;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // A literal 0,0 ("Null Island") is almost always a missing/zeroed tag.
    if (lat === 0 && lng === 0) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  } catch (_err) {
    // A broken EXIF block shouldn't fail the whole photo — treat as no GPS.
    return null;
  }
}

/**
 * Process a single uploaded photo:
 *   1. Read GPS from the original bytes (HEIC included).
 *   2. Produce a browser-viewable image, converting HEIC/HEIF -> JPEG.
 * Returns { gps, dataUrl, converted, mimeType }.
 */
async function processPhoto({ buffer, filename, mimetype }) {
  if (!buffer || buffer.length === 0) {
    throw new Error('The file was empty.');
  }

  const gps = await readGps(buffer);

  let outputBuffer = buffer;
  let outputType = 'image/jpeg';
  let converted = false;

  if (isHeic(filename, mimetype, buffer)) {
    try {
      const out = await heicConvert({ buffer, format: 'JPEG', quality: 0.9 });
      outputBuffer = Buffer.from(out);
      outputType = 'image/jpeg';
      converted = true;
    } catch (err) {
      throw new Error('HEIC conversion failed: ' + (err && err.message ? err.message : 'unknown error'));
    }
  } else {
    // Not HEIC — make sure it's actually a viewable raster image. Trust the
    // bytes over the declared mime type so a mislabelled file still fails loudly.
    const sniffed = sniffImageType(buffer);
    if (!sniffed) {
      throw new Error("This doesn't look like a readable image file.");
    }
    outputType = sniffed;
  }

  const dataUrl = `data:${outputType};base64,${outputBuffer.toString('base64')}`;
  return { gps, dataUrl, converted, mimeType: outputType };
}

module.exports = { processPhoto, isHeic, readGps, hasHeicExtension };
