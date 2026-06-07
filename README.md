# Wayfarer

A warm, interactive map of a photo journey. Wayfarer reads the geotagged photos
in its `images/` folder, pins each one to the map as a little circular photo,
and lets you fly between them and open any shot full-screen.

It is a **read-only viewer**: the published photo set is whatever lives in the
`images/` folder when the server starts. There's no uploading or editing from
the browser.

## Features

- **Auto-loads `images/`.** On startup the server reads the GPS coordinates from
  every photo and serves them to the map.
- **Photo pins.** Each photo appears as a center-cropped circular thumbnail
  styled like a pin. Click a pin to open it in the lightbox.
- **Find the spot.** The lightbox shows only a zoomed-in **center crop** of each
  photo by default, so the surroundings that give away the exact place stay
  hidden — making it a little harder to find in person. A **Help** button
  reveals the full, uncropped photo. (Crop amount is the `CROP_FRACTION`
  constant in [server.js](server.js); 0.6 = the middle 60%.)
- **Side panel index.** Every photo is listed with its coordinates (decimal +
  degrees-minutes-seconds). Click a row to fly the map to that spot.
- **Auto-fit map.** The map frames every placed photo on load.
- **Graceful with mess.** Photos with no GPS go in a "Not placed" list;
  unreadable files are flagged rather than dropped silently.
- **HEIC & JPEG.** JPEG/PNG are served directly; HEIC/HEIF are converted to JPEG
  on the fly. (The included set is all JPEG.)
- **Fast.** Pins use small cached thumbnails (~11 KB each); the lightbox serves
  an EXIF-rotated copy capped at 2200 px instead of the 24 MP originals.

## Adding or changing photos

Drop geotagged photos into [images/](images/) and restart the server. That's the
only way to change what's shown — the viewer itself can't edit the set.

## Architecture

```
wayfarer/
├── server.js              Express: scans images/, builds the manifest, serves
│                          /api/photos, /thumb/:name, /photo/:name
├── lib/process-photo.js   EXIF/GPS reading + HEIC detection/conversion
├── images/                The published photo set (read-only at runtime)
├── public/
│   ├── index.html         Layout (panel + map + lightbox)
│   ├── styles.css         Editorial travel-journal theme
│   └── app.js             Loads the manifest, draws pins, panel, lightbox
└── test/smoke.js          No-network pipeline test
```

- **`exifr`** reads GPS from each file (HEIC included), without loading whole
  images into memory.
- **`sharp`** makes the circular pin thumbnails and the capped lightbox images,
  EXIF-rotating portrait photos so they aren't sideways. Results are cached in
  memory.
- **`heic-convert`** (libheif via WebAssembly — no native build) converts any
  HEIC/HEIF photos to JPEG.
- **Leaflet** with CARTO "Voyager" tiles for a warm basemap. Pins are `divIcon`
  markers; the circular crop is pure CSS.

## Run it

Requires Node 18+.

```bash
cd wayfarer
npm install
npm start            # → http://localhost:4747
```

Set `PORT` to change the port, or `IMAGES_DIR` to point at a different folder.

```bash
npm run smoke        # quick offline test of the processing pipeline
```

### Docker

From the repo root, the `wayfarer` service mounts `./wayfarer/images` read-only:

```bash
docker compose up wayfarer    # → http://localhost:4747
```

## Notes

- **Tiles & fonts** load from CDNs, so the app needs a network connection to show
  the basemap.
- The `images/` folder is mounted **read-only** in Docker, reinforcing that the
  viewer can't modify the published set.
