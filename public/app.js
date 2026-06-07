/* ============================================================
   Wayfarer — read-only viewer
   Loads the published photo set from the server and shows it on
   an interactive map. There is no uploading or editing.
   ============================================================ */
(function () {
  'use strict';

  // ---------- Map ----------
  var TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  var TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  var map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 20, attribution: TILE_ATTR }).addTo(map);

  // ---------- State ----------
  var items = [];   // { id, name, status, lat, lng, thumb, full, marker }

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var empty = $('empty');
  var topMeta = $('topMeta');

  var placedGroup = $('placedGroup'), placedList = $('placedList'), placedCount = $('placedCount');
  var unplacedGroup = $('unplacedGroup'), unplacedList = $('unplacedList'), unplacedCount = $('unplacedCount');
  var errorGroup = $('errorGroup'), errorList = $('errorList'), errorCount = $('errorCount');
  var panelSummary = $('panelSummary');

  var lightbox = $('lightbox'), lightboxImg = $('lightboxImg'),
      lightboxName = $('lightboxName'), lightboxCoords = $('lightboxCoords'),
      lightboxHelp = $('lightboxHelp'), lightboxBadge = $('lightboxBadge');

  // ---------- Coordinate formatting ----------
  function toDMS(value, isLat) {
    var dir = value >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W');
    var abs = Math.abs(value);
    var d = Math.floor(abs);
    var mFloat = (abs - d) * 60;
    var m = Math.floor(mFloat);
    var s = Math.round((mFloat - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; d += 1; }
    return d + '°' + m + '′' + s + '″' + dir;
  }
  function decimalStr(lat, lng) { return lat.toFixed(5) + ', ' + lng.toFixed(5); }
  function dmsStr(lat, lng) { return toDMS(lat, true) + ' ' + toDMS(lng, false); }
  function fullCoords(lat, lng) { return decimalStr(lat, lng) + ' · ' + dmsStr(lat, lng); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Load the published photo set ----------
  function load() {
    // Relative URL so it resolves correctly whether the app is served from a
    // domain root (dev server) or a /<repo>/ subpath (GitHub Pages).
    fetch('photos.json')
      .then(function (res) {
        if (!res.ok) throw new Error('server responded ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var photos = (data && data.photos) || [];
        items = photos.map(function (p) {
          return {
            id: p.id,
            name: p.name,
            status: p.hasGps ? 'placed' : 'unplaced',
            lat: p.lat,
            lng: p.lng,
            thumb: p.thumb,
            crop: p.crop,
            full: p.full,
            marker: null,
          };
        });

        items.forEach(function (item) { if (item.status === 'placed') addMarker(item); });
        render();
        refitMap();

        if (items.length === 0) {
          showEmpty('No photos found', 'The images folder is empty — add some geotagged photos and restart.');
        } else {
          hideEmpty();
        }
      })
      .catch(function (err) {
        showEmpty('Could not load the photos', err && err.message ? err.message : 'Please try again.');
        panelSummary.textContent = 'Failed to load.';
      });
  }

  function showEmpty(title, text) {
    $('emptyTitle').textContent = title;
    $('emptyText').textContent = text;
    $('emptyMark').classList.remove('spin');
    empty.classList.remove('hidden');
  }
  function hideEmpty() { empty.classList.add('hidden'); }

  // ---------- Map markers ----------
  function makePinIcon(thumbUrl) {
    return L.divIcon({
      className: 'photo-pin',
      html: '<div class="pin"><div class="pin-frame"><img src="' + thumbUrl + '" alt=""></div><div class="pin-stem"></div></div>',
      iconSize: [56, 56],
      iconAnchor: [28, 62],
      popupAnchor: [0, -58],
    });
  }

  function addMarker(item) {
    var marker = L.marker([item.lat, item.lng], { icon: makePinIcon(item.thumb), riseOnHover: true });
    marker.on('click', function () { openLightbox(item); });
    marker.addTo(map);
    item.marker = marker;
  }

  function refitMap() {
    var pts = items.filter(function (i) { return i.status === 'placed'; })
                   .map(function (i) { return [i.lat, i.lng]; });
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 14);
    } else {
      map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
    }
  }

  function flyTo(item) {
    if (item.status !== 'placed') return;
    map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
    L.popup({ closeButton: true, autoClose: true })
      .setLatLng([item.lat, item.lng])
      .setContent(
        '<div class="popup-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="popup-coords">' + decimalStr(item.lat, item.lng) + '</div>' +
        '<div class="popup-hint">Click the pin to open the photo</div>'
      )
      .openOn(map);
  }

  // ---------- Lightbox ----------
  // Opens showing only the cropped "clue". The full photo is revealed via Help.
  var lightboxItem = null;

  function openLightbox(item) {
    lightboxItem = item;
    lightboxImg.src = item.crop || item.full;
    lightboxName.textContent = item.name;
    lightboxCoords.textContent = item.status === 'placed' ? fullCoords(item.lat, item.lng) : 'No location found';
    lightboxBadge.hidden = false;
    lightboxHelp.hidden = !(item.crop && item.full);
    lightbox.removeAttribute('hidden');
  }
  function revealFull() {
    if (!lightboxItem) return;
    lightboxImg.src = lightboxItem.full;
    lightboxBadge.hidden = true;
    lightboxHelp.hidden = true;
  }
  function closeLightbox() {
    lightbox.setAttribute('hidden', '');
    lightboxImg.src = '';
    lightboxItem = null;
  }
  lightboxHelp.addEventListener('click', function (e) { e.stopPropagation(); revealFull(); });
  $('lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });

  // ---------- Side panel ----------
  function buildCard(item, index) {
    var li = document.createElement('li');
    li.className = 'card';

    var img = document.createElement('img');
    img.className = 'card-thumb';
    img.src = item.thumb;
    img.alt = '';
    img.loading = 'lazy';
    img.title = 'Open photo';
    img.addEventListener('click', function (e) { e.stopPropagation(); openLightbox(item); });
    li.appendChild(img);

    var body = document.createElement('div');
    body.className = 'card-body';

    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = item.name;
    body.appendChild(name);

    var meta = document.createElement('div');
    meta.className = 'card-meta';
    if (item.status === 'placed') {
      meta.innerHTML = decimalStr(item.lat, item.lng) +
        '<span class="card-coords-dms">' + dmsStr(item.lat, item.lng) + '</span>';
    } else {
      meta.textContent = 'No location found';
    }
    body.appendChild(meta);
    li.appendChild(body);

    if (item.status === 'placed') {
      var idx = document.createElement('span');
      idx.className = 'card-index';
      idx.textContent = index;
      li.appendChild(idx);
      li.addEventListener('click', function () {
        flyTo(item);
        li.classList.remove('flash');
        void li.offsetWidth; // restart animation
        li.classList.add('flash');
      });
    } else {
      li.addEventListener('click', function () { openLightbox(item); });
    }

    return li;
  }

  function render() {
    var placed = items.filter(function (i) { return i.status === 'placed'; });
    var unplaced = items.filter(function (i) { return i.status === 'unplaced'; });
    var errored = items.filter(function (i) { return i.status === 'error'; });

    placedList.innerHTML = '';
    placed.forEach(function (i, n) { placedList.appendChild(buildCard(i, n + 1)); });
    placedGroup.hidden = placed.length === 0;
    placedCount.textContent = placed.length;

    unplacedList.innerHTML = '';
    unplaced.forEach(function (i) { unplacedList.appendChild(buildCard(i, '')); });
    unplacedGroup.hidden = unplaced.length === 0;
    unplacedCount.textContent = unplaced.length;

    errorList.innerHTML = '';
    errored.forEach(function (i) { errorList.appendChild(buildCard(i, '')); });
    errorGroup.hidden = errored.length === 0;
    errorCount.textContent = errored.length;

    // Summary line + header chip
    if (items.length === 0) {
      panelSummary.textContent = 'No photos.';
      topMeta.textContent = '';
    } else {
      var parts = [items.length + (items.length === 1 ? ' photo' : ' photos')];
      if (placed.length) parts.push(placed.length + ' pinned');
      if (unplaced.length) parts.push(unplaced.length + ' not placed');
      panelSummary.textContent = parts.join('  ·  ');
      topMeta.textContent = placed.length + ' places · ' + items.length + ' photos';
    }
  }

  // ---------- Collapsible side panel ----------
  // Starts collapsed (the `collapsed` class is set in the markup). The toggle
  // slides it in/out; the map is re-measured as it animates so tiles fill the
  // reclaimed space smoothly.
  var panel = $('panel');
  var panelToggle = $('panelToggle');

  function setPanelOpen(open) {
    panel.classList.toggle('collapsed', !open);
    panelToggle.setAttribute('aria-expanded', String(open));
    panelToggle.setAttribute('aria-label', open ? 'Hide the photo list' : 'Show the photo list');
    panelToggle.title = open ? 'Hide the roll' : 'Show the roll';
    for (var d = 0; d <= 320; d += 80) setTimeout(function () { map.invalidateSize(); }, d);
  }

  panelToggle.addEventListener('click', function () {
    setPanelOpen(panel.classList.contains('collapsed'));
  });

  // a gentle nudge to keep the map sized correctly after layout settles
  setTimeout(function () { map.invalidateSize(); }, 200);
  window.addEventListener('resize', function () { map.invalidateSize(); });

  load();
})();
