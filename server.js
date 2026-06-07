'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { readGps, isHeic } = require('./lib/process-photo');

const app = express();

// The published photo set. Read-only: the gallery is whatever lives in this
// folder when the server starts. Nothing is uploaded or written here.
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
const IMAGE_RE = /\.(jpe?g|png|tiff?|webp|heic|heif)$/i;
const HEIC_RE = /\.(heic|heif)$/i;
const THUMB_SIZE = 256;      // square cover-crop for the circular pins/panel
const THUMB_QUALITY = 72;

const PHOTO_MAX = 2200;      // longest-side cap for the lightbox image
const PHOTO_QUALITY = 82;
// The default lightbox view is a center crop showing this fraction of each
// dimension (0.4 → the middle 40% × 40%). Smaller = harder to recognise the
// place. The full photo is revealed via the "Help" button.
const CROP_FRACTION = 0.4;

let MANIFEST = [];                 // [{ id, name, hasGps, lat, lng, thumb, crop, full }]
const thumbCache = new Map();      // name -> JPEG Buffer (pins / panel)
const cropCache = new Map();       // name -> JPEG Buffer (cropped lightbox clue)
const photoCache = new Map();      // name -> JPEG Buffer (full lightbox / Help)

function mimeFromName(name) {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.(tiff?|tif)$/i.test(name)) return 'image/tiff';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.gif$/i.test(name)) return 'image/gif';
  return 'image/jpeg';
}

function listImageFiles() {
  try {
    return fs.readdirSync(IMAGES_DIR).filter(function (f) { return IMAGE_RE.test(f); }).sort();
  } catch (err) {
    return [];
  }
}

// Return a browser-viewable buffer for a file (converting HEIC -> JPEG).
async function readViewable(name) {
  const buf = fs.readFileSync(path.join(IMAGES_DIR, name));
  if (HEIC_RE.test(name) || isHeic(name, '', buf)) {
    const out = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.92 });
    return { buffer: Buffer.from(out), type: 'image/jpeg' };
  }
  return { buffer: buf, type: mimeFromName(name) };
}

// Scan the folder once at startup: read GPS for each photo and build the
// manifest the frontend renders from.
async function buildManifest() {
  const files = listImageFiles();
  const out = [];
  let id = 1;
  for (const name of files) {
    let gps = null;
    try {
      gps = await readGps(path.join(IMAGES_DIR, name));
    } catch (err) {
      gps = null;
    }
    out.push({
      id: id++,
      name: name,
      hasGps: Boolean(gps),
      lat: gps ? gps.lat : null,
      lng: gps ? gps.lng : null,
      thumb: 'thumb/' + encodeURIComponent(name),
      crop: 'crop/' + encodeURIComponent(name),
      full: 'photo/' + encodeURIComponent(name),
    });
  }
  MANIFEST = out;
}

app.use(express.static(path.join(__dirname, 'public')));

// The manifest powering the map. Named photos.json so the live server and the
// static build (build-static.js) expose it at the same relative URL.
app.get('/photos.json', function (req, res) {
  const placed = MANIFEST.filter(function (p) { return p.hasGps; }).length;
  res.json({ count: MANIFEST.length, placed: placed, photos: MANIFEST });
});

// Small square thumbnail for the circular pins + side panel. EXIF-rotated so
// portrait photos aren't sideways, then cached in memory.
app.get('/thumb/:name', async function (req, res) {
  const name = req.params.name;
  if (!MANIFEST.some(function (p) { return p.name === name; })) return res.status(404).end();
  try {
    let buf = thumbCache.get(name);
    if (!buf) {
      const viewable = await readViewable(name);
      buf = await sharp(viewable.buffer)
        .rotate()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: THUMB_QUALITY })
        .toBuffer();
      thumbCache.set(name, buf);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg');
    res.end(buf);
  } catch (err) {
    res.status(500).end();
  }
});

// Full, uncropped photo for the lightbox — EXIF-rotated and capped to a
// screen-friendly size (the originals are 24MP / up to ~10MB). Cached.
app.get('/photo/:name', async function (req, res) {
  const name = req.params.name;
  if (!MANIFEST.some(function (p) { return p.name === name; })) return res.status(404).end();
  try {
    let buf = photoCache.get(name);
    if (!buf) {
      const viewable = await readViewable(name);
      buf = await sharp(viewable.buffer)
        .rotate()
        .resize(PHOTO_MAX, PHOTO_MAX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: PHOTO_QUALITY })
        .toBuffer();
      photoCache.set(name, buf);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg');
    res.end(buf);
  } catch (err) {
    res.status(500).end();
  }
});

// Cropped "clue" for the lightbox: the center CROP_FRACTION of the photo, so
// the surroundings that give away the exact spot stay hidden until "Help".
app.get('/crop/:name', async function (req, res) {
  const name = req.params.name;
  if (!MANIFEST.some(function (p) { return p.name === name; })) return res.status(404).end();
  try {
    let buf = cropCache.get(name);
    if (!buf) {
      const viewable = await readViewable(name);
      // Rotate first so the crop is centered on the upright image.
      const rotated = await sharp(viewable.buffer).rotate().toBuffer({ resolveWithObject: true });
      const w = rotated.info.width;
      const h = rotated.info.height;
      const cw = Math.max(1, Math.round(w * CROP_FRACTION));
      const ch = Math.max(1, Math.round(h * CROP_FRACTION));
      const left = Math.floor((w - cw) / 2);
      const top = Math.floor((h - ch) / 2);
      buf = await sharp(rotated.data)
        .extract({ left: left, top: top, width: cw, height: ch })
        .resize(PHOTO_MAX, PHOTO_MAX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: PHOTO_QUALITY })
        .toBuffer();
      cropCache.set(name, buf);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg');
    res.end(buf);
  } catch (err) {
    res.status(500).end();
  }
});

const PORT = process.env.PORT || 4747;
buildManifest()
  .then(function () {
    const placed = MANIFEST.filter(function (p) { return p.hasGps; }).length;
    app.listen(PORT, function () {
      console.log('\n  Wayfarer is running → http://localhost:' + PORT);
      console.log('  Loaded ' + MANIFEST.length + ' photos from ' + IMAGES_DIR +
        ' (' + placed + ' placed, ' + (MANIFEST.length - placed) + ' not placed)\n');
    });
  })
  .catch(function (err) {
    console.error('Failed to read the images folder:', err);
    process.exit(1);
  });
