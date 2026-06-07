'use strict';

/*
 * A tiny no-network smoke test for the processing pipeline. It checks:
 *   1. The dependencies load (so `npm install` actually worked).
 *   2. A plain image with no GPS is handled gracefully (hasGps:false, still viewable).
 *   3. HEIC/HEIF magic-byte sniffing works regardless of filename/mime.
 *
 * Real HEIC conversion + GPS extraction are exercised by uploading actual
 * phone photos through the running app — those need real EXIF, which we
 * can't hand-author here.
 */

const assert = require('assert');
const { processPhoto, isHeic } = require('../lib/process-photo');
const { assignSets, NUM_SETS } = require('../lib/sets');

// 1x1 transparent PNG — no EXIF, no GPS.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function makeFtyp(brand) {
  // 4-byte box size + 'ftyp' + 4-byte major brand + minor version.
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from(brand, 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

(async function run() {
  // (2) No-GPS image
  const result = await processPhoto({ buffer: PNG_1x1, filename: 'note.png', mimetype: 'image/png' });
  assert.strictEqual(result.gps, null, 'a plain PNG should have no GPS');
  assert.ok(result.dataUrl.startsWith('data:image/png;base64,'), 'should return a viewable data URL');
  assert.strictEqual(result.converted, false, 'a PNG should not be converted');

  // (3) HEIC sniffing
  assert.strictEqual(isHeic('IMG_0001.HEIC', '', null), true, 'detect by extension');
  assert.strictEqual(isHeic('x', 'image/heic', null), true, 'detect by mime type');
  assert.strictEqual(isHeic('mystery', 'application/octet-stream', makeFtyp('heic')), true, 'detect by magic bytes (heic)');
  assert.strictEqual(isHeic('mystery', 'application/octet-stream', makeFtyp('mif1')), true, 'detect by magic bytes (mif1)');
  assert.strictEqual(isHeic('photo.jpg', 'image/jpeg', PNG_1x1), false, 'a JPEG/PNG is not HEIC');

  // (4) Set assignment: each set shows at most one photo per location, the same
  // photo may span several sets, and lone/un-located photos appear in every set.
  const A = { hasGps: true, lat: 32.0, lng: 34.0 };           // location 1
  const B = { hasGps: true, lat: 32.0000449, lng: 34.0 };     // ~5 m from A → same location
  const C = { hasGps: true, lat: 32.01, lng: 34.0 };          // ~1.1 km away → its own location
  const D = { hasGps: false, lat: null, lng: null };          // no GPS
  assignSets([A, B, C, D]);

  assert.deepStrictEqual(A.sets.filter((s) => B.sets.includes(s)), [],
    'two photos at the same location must never share a set');
  assert.deepStrictEqual(
    A.sets.concat(B.sets).sort(),
    Array.from({ length: NUM_SETS }, (_, i) => i + 1),
    'the near-duplicate pair should together cover every set');
  assert.strictEqual(C.sets.length, NUM_SETS, 'a lone photo appears in every set');
  assert.strictEqual(D.sets.length, NUM_SETS, 'an un-located photo appears in every set');

  // empty input rejected
  let threw = false;
  try { await processPhoto({ buffer: Buffer.alloc(0), filename: 'empty', mimetype: '' }); }
  catch (_e) { threw = true; }
  assert.ok(threw, 'empty buffer should throw');

  console.log('✓ smoke test passed');
})().catch(function (err) {
  console.error('✗ smoke test failed:', err.message);
  process.exit(1);
});
