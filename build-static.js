'use strict';

/*
 * Static-site build for GitHub Pages (or any plain file host).
 *
 * The running app (server.js) generates the manifest and every thumb/crop/photo
 * on the fly. But the gallery is read-only and fixed at startup, so every one of
 * those responses is identical on each request. This script renders them ONCE,
 * up front, into ./dist as ordinary files that any static host can serve:
 *
 *   dist/
 *     index.html  styles.css  app.js   (copied from public/)
 *     photos.json                       (the manifest app.js fetches)
 *     thumb/<photo>.jpg  crop/<photo>.jpg  photo/<photo>.jpg
 *     .nojekyll                         (stop GitHub Pages' Jekyll from touching it)
 *
 * Every URL in the manifest is RELATIVE (no leading slash) so the site works
 * unchanged whether it's served from a domain root or a /<repo>/ subpath.
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { readGps, isHeic } = require('./lib/process-photo');

// Keep these in lockstep with server.js so the static output is byte-for-byte
// the same as what the live server would produce.
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');

const IMAGE_RE = /\.(jpe?g|png|tiff?|webp|heic|heif)$/i;
const HEIC_RE = /\.(heic|heif)$/i;
const THUMB_SIZE = 256;
const THUMB_QUALITY = 72;
const PHOTO_MAX = 2200;
const PHOTO_QUALITY = 82;
const CROP_FRACTION = 0.6;

function mimeFromName(name) {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.(tiff?|tif)$/i.test(name)) return 'image/tiff';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.gif$/i.test(name)) return 'image/gif';
  return 'image/jpeg';
}

function listImageFiles() {
  try {
    return fs.readdirSync(IMAGES_DIR).filter((f) => IMAGE_RE.test(f)).sort();
  } catch (err) {
    return [];
  }
}

async function readViewable(name) {
  const buf = fs.readFileSync(path.join(IMAGES_DIR, name));
  if (HEIC_RE.test(name) || isHeic(name, '', buf)) {
    const out = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.92 });
    return { buffer: Buffer.from(out), type: 'image/jpeg' };
  }
  return { buffer: buf, type: mimeFromName(name) };
}

// ---- sharp pipelines, identical to the server's /thumb, /photo, /crop ----

async function makeThumb(viewable) {
  return sharp(viewable.buffer)
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();
}

async function makePhoto(viewable) {
  return sharp(viewable.buffer)
    .rotate()
    .resize(PHOTO_MAX, PHOTO_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PHOTO_QUALITY })
    .toBuffer();
}

async function makeCrop(viewable) {
  const rotated = await sharp(viewable.buffer).rotate().toBuffer({ resolveWithObject: true });
  const w = rotated.info.width;
  const h = rotated.info.height;
  const cw = Math.max(1, Math.round(w * CROP_FRACTION));
  const ch = Math.max(1, Math.round(h * CROP_FRACTION));
  const left = Math.floor((w - cw) / 2);
  const top = Math.floor((h - ch) / 2);
  return sharp(rotated.data)
    .extract({ left, top, width: cw, height: ch })
    .resize(PHOTO_MAX, PHOTO_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PHOTO_QUALITY })
    .toBuffer();
}

// Every rendered file is a JPEG, so force a .jpg extension (a static host sets
// Content-Type from the extension — a ".heic" file would never display).
function outName(name) {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function build() {
  const files = listImageFiles();
  if (files.length === 0) {
    console.warn('No images found in ' + IMAGES_DIR + ' — building an empty site.');
  }

  rmrf(OUT_DIR);
  fs.mkdirSync(path.join(OUT_DIR, 'thumb'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'crop'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'photo'), { recursive: true });

  // Copy the frontend verbatim.
  for (const f of ['index.html', 'styles.css', 'app.js']) {
    fs.copyFileSync(path.join(PUBLIC_DIR, f), path.join(OUT_DIR, f));
  }
  // Disable Jekyll so nothing gets rewritten/stripped on GitHub Pages.
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  const seen = new Set();
  const manifest = [];
  let id = 1;
  let placed = 0;

  for (const name of files) {
    const out = outName(name);
    if (seen.has(out)) {
      throw new Error(
        'Output name collision: "' + name + '" and another file both map to "' + out + '".'
      );
    }
    seen.add(out);

    let gps = null;
    try {
      gps = await readGps(path.join(IMAGES_DIR, name));
    } catch (err) {
      gps = null;
    }

    const viewable = await readViewable(name);
    const [thumb, photo, crop] = await Promise.all([
      makeThumb(viewable),
      makePhoto(viewable),
      makeCrop(viewable),
    ]);

    fs.writeFileSync(path.join(OUT_DIR, 'thumb', out), thumb);
    fs.writeFileSync(path.join(OUT_DIR, 'photo', out), photo);
    fs.writeFileSync(path.join(OUT_DIR, 'crop', out), crop);

    const enc = encodeURIComponent(out);
    if (gps) placed++;
    manifest.push({
      id: id++,
      name: name,
      hasGps: Boolean(gps),
      lat: gps ? gps.lat : null,
      lng: gps ? gps.lng : null,
      thumb: 'thumb/' + enc,
      crop: 'crop/' + enc,
      full: 'photo/' + enc,
    });

    console.log('  ✓ ' + name + (gps ? '  (placed)' : '  (no GPS)'));
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'photos.json'),
    JSON.stringify({ count: manifest.length, placed: placed, photos: manifest })
  );

  console.log(
    '\nBuilt ' + manifest.length + ' photos into ' + OUT_DIR +
    ' (' + placed + ' placed, ' + (manifest.length - placed) + ' not placed).'
  );
}

build().catch((err) => {
  console.error('Static build failed:', err);
  process.exit(1);
});
