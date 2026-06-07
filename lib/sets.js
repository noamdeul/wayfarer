'use strict';

/*
 * Image sets.
 *
 * The gallery is split into NUM_SETS sets. Each set is a *complete* tour of
 * every distinct location — but where several photos were taken very close
 * together (a burst, a few steps apart), a single set shows only ONE of them.
 * Different sets may pick a different one, and the same photo can appear in
 * more than one set. The frontend shows a set when the URL carries `?set=N`.
 */

// How many sets to generate.
const NUM_SETS = 4;

// Two photos within this many metres are treated as "the same location", so a
// single set never shows more than one of them.
const LOCATION_RADIUS_M = 10;

const EARTH_R = 6371000; // metres

// Distance between two {lat,lng} points. Equirectangular approximation — more
// than accurate enough at the ~10 m scale we cluster at.
function distanceMeters(a, b) {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = dLng * Math.cos(lat);
  const y = dLat;
  return Math.sqrt(x * x + y * y) * EARTH_R;
}

// The set numbers (1..NUM_SETS) that show the photo at index `k` of a location
// holding `n` photos: every set `s` where (s - 1) % n === k. So a lone photo
// (n = 1) lands in every set; locations with 2-3 photos cycle their photos
// across the sets; the s-th photo of a 4+ photo location anchors set s.
function setsForIndex(k, n) {
  const sets = [];
  for (let s = 1; s <= NUM_SETS; s++) {
    if ((s - 1) % n === k) sets.push(s);
  }
  return sets;
}

/**
 * Give every photo a `sets` array (1-based set numbers it belongs to).
 *
 * Placed photos are grouped into locations greedily: a photo joins the first
 * existing cluster whose seed is within LOCATION_RADIUS_M, otherwise it starts
 * a new one. Photos are visited in the order given (chronological filename
 * order keeps burst shots together). Photos with no GPS have no location to
 * clash with, so they appear in every set.
 *
 * Mutates each photo (adds `photo.sets`) and returns the same array.
 */
function assignSets(photos) {
  const clusters = []; // { seed: photo, members: [photo, ...] }

  for (const p of photos) {
    if (!p.hasGps) { p.sets = setsForIndex(0, 1); continue; } // every set
    let cluster = null;
    for (const c of clusters) {
      if (distanceMeters(c.seed, p) <= LOCATION_RADIUS_M) { cluster = c; break; }
    }
    if (!cluster) { cluster = { seed: p, members: [] }; clusters.push(cluster); }
    cluster.members.push(p);
  }

  for (const c of clusters) {
    c.members.forEach((p, k) => { p.sets = setsForIndex(k, c.members.length); });
  }

  return photos;
}

module.exports = { assignSets, setsForIndex, distanceMeters, NUM_SETS, LOCATION_RADIUS_M };
