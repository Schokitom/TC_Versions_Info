// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v2
//  HiDPI-scharfes Rendering + externes Fenster (Multi-Monitor)
// ═══════════════════════════════════════════════════════════════
//
//  Verbesserungen gegenüber v1:
//  - Gestochen scharfes PDF-Rendering (DevicePixelRatio-aware)
//  - Zwei Abkoppel-Modi:
//    1) "Floating" — draggbar innerhalb des Browsers (wie v1)
//    2) "Externes Fenster" — echtes Browser-Fenster, verschiebbar
//       auf anderen Monitor, vollbildfähig (F11)
//  - Progressive Seiten-Renderung (Viewport-basiert)
//
//  Integration: <script src="viewer-v2.js"></script>
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

  var _pdfjsLib = null;
  var _currentPdf = null;
  var _currentPage = 1;
  var _currentZoom = 1.0;
  var _currentFile = null;
  var _isDetached = false;
  var _detachedContainer = null;
  var _currentBlobUrl = null;
  var _externalWindow = null;

  function loadPdfJs() {
    if (_pdfjsLib) return Promise.resolve(_pdfjsLib);
    return import(PDFJS_URL).then(function(lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      _pdfjsLib = lib;
      return lib;
    });
  }

  function getDownloadUrl(fileId) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }).then(function(r) {
      if (!r.ok) throw new Error('Download-URL Fehler: ' + r.status);
      return r.json();
    }).then(function(data) {
      if (!data || !data.url) throw new Error('Keine Download-URL im Response');
      return data.url;
    });
  }

  function getFileKind(name) {
    var lower = (name || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lower)) return 'image';
    return 'other';
  }

  function injectStyles() {
    if (document.getElementById('sl-viewer-styles')) return;
    var css =
      '.sl-viewer-container { position: relative; width: 100%; height: 100%; background: #1a1d27; display: flex; flex-direction: column; overflow: hidden; }' +
      '.sl-viewer-toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: #0f1117; border-bottom: 1px solid #2a2d3e; flex-shrink: 0; flex-wrap: wrap; }' +
      '.sl-viewer-btn { background: none; border: 1px solid #2a2d3e; border-radius: 4px; color: #7a8199; cursor: pointer; padding: 3px 8px; font-size: 11px; font-family: var(--font-ui, sans-serif); display: inline-flex; align-items: center; gap: 3px; transition: all .15s; white-space: nowrap; }' +
      '.sl-viewer-btn:hover:not(:disabled) { border-color: #00c2ff; color: #00c2ff; background: #1e2235; }' +
      '.sl-viewer-btn:disabled { opacity: .4; cursor: not-allowed; }' +
      '.sl-viewer-btn svg { width: 12px; height: 12px; fill: currentColor; }' +
      '.sl-viewer-btn.primary { background: #005f8a; color: #fff; border-color: #00c2ff; }' +
      '.sl-viewer-btn.primary:hover { background: #00c2ff; }' +
      '.sl-viewer-page-info { font-family: var(--font, monospace); font-size: 11px; color: #7a8199; padding: 0 4px; min-width: 60px; text-align: center; }' +
      '.sl-viewer-zoom-info { font-family: var(--font, monospace); font-size: 11px; color: #7a8199; min-width: 40px; text-align: center; }' +
      '.sl-viewer-spacer { flex: 1; }' +
      '.sl-viewer-canvas-wrap { flex: 1; overflow: auto; background: #2a2d3e; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; }' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar { width: 8px; height: 8px; }' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }' +
      '.sl-viewer-page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.4); max-width: 100%; }' +
      '.sl-viewer-image { max-width: 100%; max-height: 100%; box-shadow: 0 2px 8px rgba(0,0,0,.4); image-rendering: -webkit-optimize-contrast; }' +
      '.sl-viewer-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #7a8199; gap: 12px; }' +
      '.sl-viewer-spinner { width: 36px; height: 36px; border: 3px solid #2a2d3e; border-top-color: #00c2ff; border-radius: 50%; animation: sl-spin .7s linear infinite; }' +
      '@keyframes sl-spin { to { transform: rotate(360deg); } }' +
      '.sl-viewer-error { color: #ef4444; padding: 20px; text-align: center; font-size: 12px; }' +
      '.sl-floating-viewer { position: fixed; top: 80px; left: 80px; width: 800px; height: 600px; background: #1a1d27; border: 1px solid #00c2ff; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.6); z-index: 9999; display: flex; flex-direction: column; overflow: hidden; min-width: 400px; min-height: 300px; resize: both; }' +
      '.sl-floating-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #0f1117; border-bottom: 1px solid #2a2d3e; cursor: move; user-select: none; flex-shrink: 0; }' +
      '.sl-floating-header .title { flex: 1; font-size: 12px; font-weight: 600; color: #e4e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
      '.sl-floating-close { background: none; border: none; color: #7a8199; cursor: pointer; font-size: 16px; padding: 0 4px; }' +
      '.sl-floating-close:hover { color: #ef4444; }' +
      '.sl-floating-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }' +
      '.sl-dropdown { position: relative; display: inline-block; }' +
      '.sl-dropdown-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 2px; background: #1a1d27; border: 1px solid #00c2ff; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.5); z-index: 100; min-width: 200px; overflow: hidden; }' +
      '.sl-dropdown.open .sl-dropdown-menu { display: block; }' +
      '.sl-dropdown-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; color: #e4e8f0; font-size: 12px; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }' +
      '.sl-dropdown-item:hover { background: #1e2235; color: #00c2ff; }' +
      '.sl-dropdown-item svg { width: 14px; height: 14px; fill: currentColor; flex-shrink: 0; }' +
      '.sl-dropdown-divider { height: 1px; background: #2a2d3e; margin: 2px 0; }';
    var style = document.createElement('style');
    style.id = 'sl-viewer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildViewerHTML(kind) {
    var pdfControls = kind === 'pdf' ?
      '<button class="sl-viewer-btn" id="sl-prev-page" title="Vorherige Seite"><svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
      '<span class="sl-viewer-page-info" id="sl-page-info">–</span>' +
      '<button class="sl-viewer-btn" id="sl-next-page" title="Nächste Seite"><svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>'
      : '';

    return '' +
      '<div class="sl-viewer-toolbar">' +
        pdfControls +
        '<button class="sl-viewer-btn" id="sl-zoom-out" title="Verkleinern">−</button>' +
        '<span class="sl-viewer-zoom-info" id="sl-zoom-info">100%</span>' +
        '<button class="sl-viewer-btn" id="sl-zoom-in" title="Vergrößern">+</button>' +
        '<button class="sl-viewer-btn" id="sl-zoom-fit" title="Anpassen">Fit</button>' +
        '<div class="sl-viewer-spacer"></div>' +
        '<div class="sl-dropdown" id="sl-detach-dropdown">' +
          '<button class="sl-viewer-btn" id="sl-detach-btn" title="Abkoppeln-Optionen">' +
            '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3m-2 16H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z"/></svg>' +
            '<span id="sl-detach-label">Abkoppeln</span>' +
            '<svg viewBox="0 0 24 24" width="10" height="10"><path d="M7 10l5 5 5-5z"/></svg>' +
          '</button>' +
          '<div class="sl-dropdown-menu">' +
            '<button class="sl-dropdown-item" id="sl-detach-floating">' +
              '<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>' +
              '<div><div>Floating-Fenster</div><div style="font-size:10px;color:#7a8199">Im Browser verschiebbar</div></div>' +
            '</button>' +
            '<button class="sl-dropdown-item" id="sl-detach-external">' +
              '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg>' +
              '<div><div>Externes Fenster</div><div style="font-size:10px;color:#7a8199">Eigenes Browser-Fenster (z.B. 2. Monitor)</div></div>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<button class="sl-viewer-btn" id="sl-download" title="Download">' +
          '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="sl-viewer-canvas-wrap" id="sl-canvas-wrap">' +
        '<div class="sl-viewer-loading"><div class="sl-viewer-spinner"></div><div>Lade…</div></div>' +
      '</div>';
  }

  // ─── HiDPI-scharfes PDF-Rendering ───
  function renderPdfPage(pdf, pageNum, canvas, zoom) {
    return pdf.getPage(pageNum).then(function(page) {
      // Device Pixel Ratio für scharfe Wiedergabe auf HiDPI-Displays
      var dpr = window.devicePixelRatio || 1;

      // Base-Scale: je nach Zoom, aber mindestens 2x für gute Qualität
      var renderScale = zoom * 2.0 * dpr;

      var viewport = page.getViewport({ scale: renderScale });

      // Canvas physische Größe (für scharfe Pixel)
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Canvas CSS-Größe (visuelle Darstellung) — halbiert wegen dpr+2x
      var cssWidth = viewport.width / (2.0 * dpr);
      var cssHeight = viewport.height / (2.0 * dpr);
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';

      var ctx = canvas.getContext('2d');
      return page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;
    });
  }

  function renderPdf(pdf, targetWrap) {
    targetWrap.innerHTML = '';
    _currentPage = 1;

    var renderPromises = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      (function(pageNum) {
        var canvas = document.createElement('canvas');
        canvas.className = 'sl-viewer-page';
        canvas.id = 'sl-page-' + pageNum;
        targetWrap.appendChild(canvas);
        renderPromises.push(renderPdfPage(pdf, pageNum, canvas, _currentZoom));
      })(i);
    }

    updatePageInfo();
    updateZoomInfo();
    return Promise.all(renderPromises);
  }

  function rerenderCurrentPdf() {
    if (!_currentPdf) return;
    var wrap = document.getElementById('sl-canvas-wrap');
    if (!wrap) return;
    // Scroll-Position merken
    var scrollTop = wrap.scrollTop;
    renderPdf(_currentPdf, wrap).then(function() {
      wrap.scrollTop = scrollTop;
    });
  }

  function updatePageInfo() {
    var el = document.getElementById('sl-page-info');
    if (el && _currentPdf) el.textContent = _currentPage + ' / ' + _currentPdf.numPages;
  }

  function updateZoomInfo() {
    var el = document.getElementById('sl-zoom-info');
    if (el) el.textContent = Math.round(_currentZoom * 100) + '%';
  }

  function scrollToPage(pageNum) {
    var target = document.getElementById('sl-page-' + pageNum);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      _currentPage = pageNum;
      updatePageInfo();
    }
  }

  function prevPage() { if (_currentPage > 1) scrollToPage(_currentPage - 1); }
  function nextPage() { if (_currentPdf && _currentPage < _currentPdf.numPages) scrollToPage(_currentPage + 1); }

  function zoomIn() {
    _currentZoom = Math.min(_currentZoom + 0.15, 4);
    updateZoomInfo();
    if (_currentPdf) rerenderCurrentPdf();
    else applyImageZoom();
  }

  function zoomOut() {
    _currentZoom = Math.max(_currentZoom - 0.15, 0.3);
    updateZoomInfo();
    if (_currentPdf) rerenderCurrentPdf();
    else applyImageZoom();
  }

  function zoomFit() {
    _currentZoom = 1.0;
    updateZoomInfo();
    if (_currentPdf) rerenderCurrentPdf();
    else applyImageZoom();
  }

  function applyImageZoom() {
    var img = document.querySelector('.sl-viewer-image');
    if (img) img.style.transform = 'scale(' + _currentZoom + ')';
  }

  // ─── Detach-Modi ───
  function detachFloating() {
    closeDropdown();
    if (_isDetached) return attachFromFloating();
    _isDetached = true;

    var panel = document.getElementById('previewPanel');
    var bodyEl = document.getElementById('previewBody');
    if (!panel || !bodyEl) return;

    var floating = document.createElement('div');
    floating.className = 'sl-floating-viewer';
    floating.id = 'sl-floating';

    var titleText = _currentFile ? _currentFile.name : 'Vorschau';
    floating.innerHTML =
      '<div class="sl-floating-header" id="sl-floating-header">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z"/></svg>' +
        '<div class="title">' + escHtml(titleText) + '</div>' +
        '<button class="sl-floating-close" id="sl-floating-close" title="Schließen">✕</button>' +
      '</div>' +
      '<div class="sl-floating-body" id="sl-floating-body"></div>';

    document.body.appendChild(floating);
    _detachedContainer = floating;

    var viewerContainer = bodyEl.querySelector('.sl-viewer-container');
    if (viewerContainer) {
      document.getElementById('sl-floating-body').appendChild(viewerContainer);
    }

    var label = document.getElementById('sl-detach-label');
    if (label) label.textContent = 'Andocken';

    panel.classList.remove('open');
    var handle = document.getElementById('previewResizeHandle');
    if (handle) handle.style.display = 'none';

    setupDrag(floating);

    document.getElementById('sl-floating-close').onclick = function() {
      closeFloating();
    };
  }

  function attachFromFloating() {
    if (!_isDetached) return;
    _isDetached = false;

    var floating = document.getElementById('sl-floating');
    var bodyEl = document.getElementById('previewBody');
    var panel = document.getElementById('previewPanel');

    if (floating && bodyEl) {
      var viewerContainer = floating.querySelector('.sl-viewer-container');
      if (viewerContainer) bodyEl.appendChild(viewerContainer);
      floating.remove();
    }

    if (panel) panel.classList.add('open');
    var handle = document.getElementById('previewResizeHandle');
    if (handle) handle.style.display = '';

    var label = document.getElementById('sl-detach-label');
    if (label) label.textContent = 'Abkoppeln';

    _detachedContainer = null;
  }

  function closeFloating() {
    var floating = document.getElementById('sl-floating');
    if (floating) floating.remove();
    _isDetached = false;
    _detachedContainer = null;

    var panel = document.getElementById('previewPanel');
    var handle = document.getElementById('previewResizeHandle');
    if (panel) panel.classList.remove('open');
    if (handle) handle.style.display = 'none';
    cleanupCurrentBlob();
    _currentFile = null;
    _currentPdf = null;
  }

  // ─── NEU: Externes Fenster (Multi-Monitor-fähig) ───
  function detachExternal() {
    closeDropdown();
    if (!_currentFile) return;

    var fileId = getFileId(_currentFile);
    if (!fileId) return;

    var kind = getFileKind(_currentFile.name);
    var fileName = _currentFile.name;

    // Vorhandenes Blob-URL wiederverwenden falls möglich
    var blobUrl = _currentBlobUrl;

    // Neues Fenster öffnen
    var w = 1200;
    var h = 900;
    var features = 'width=' + w + ',height=' + h + ',menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';
    var extWin = window.open('', '_blank', features);

    if (!extWin) {
      alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
      return;
    }

    _externalWindow = extWin;

    // HTML für externes Fenster schreiben
    var htmlDoc = '<!DOCTYPE html><html lang="de"><head>' +
      '<meta charset="UTF-8">' +
      '<title>' + escHtml(fileName) + ' — S+L Viewer</title>' +
      '<style>' +
        '* { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { background: #1a1d27; color: #e4e8f0; font-family: "DM Sans", "Segoe UI", sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }' +
        '.toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #0f1117; border-bottom: 1px solid #2a2d3e; flex-shrink: 0; }' +
        '.title { flex: 1; font-size: 13px; font-weight: 600; color: #e4e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 8px; }' +
        'button { background: none; border: 1px solid #2a2d3e; border-radius: 4px; color: #7a8199; cursor: pointer; padding: 4px 10px; font-size: 12px; font-family: inherit; display: inline-flex; align-items: center; gap: 4px; transition: all .15s; }' +
        'button:hover:not(:disabled) { border-color: #00c2ff; color: #00c2ff; background: #1e2235; }' +
        'button:disabled { opacity: .4; cursor: not-allowed; }' +
        'button svg { width: 14px; height: 14px; fill: currentColor; }' +
        '.info { font-family: "DM Mono", monospace; font-size: 12px; color: #7a8199; padding: 0 6px; }' +
        '.spacer { flex: 1; }' +
        '.wrap { flex: 1; overflow: auto; background: #2a2d3e; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }' +
        '.wrap::-webkit-scrollbar { width: 10px; height: 10px; }' +
        '.wrap::-webkit-scrollbar-thumb { background: #555; border-radius: 5px; }' +
        '.page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.5); max-width: 100%; }' +
        '.image { max-width: 100%; max-height: 100%; box-shadow: 0 2px 8px rgba(0,0,0,.5); transform-origin: center center; transition: transform .15s; image-rendering: -webkit-optimize-contrast; }' +
        '.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #7a8199; gap: 12px; }' +
        '.spinner { width: 40px; height: 40px; border: 3px solid #2a2d3e; border-top-color: #00c2ff; border-radius: 50%; animation: spin .7s linear infinite; }' +
        '@keyframes spin { to { transform: rotate(360deg); } }' +
        '.error { color: #ef4444; padding: 20px; text-align: center; }' +
        '.hint { padding: 6px 12px; background: #005f8a; color: #fff; font-size: 11px; text-align: center; }' +
      '</style>' +
      '</head><body>' +
      '<div class="hint">💡 Dieses Fenster kann auf einen anderen Monitor gezogen werden. F11 = Vollbild</div>' +
      '<div class="toolbar">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title">' + escHtml(fileName) + '</div>' +
        (kind === 'pdf' ?
          '<button id="prevPage" title="Vorherige Seite"><svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
          '<span class="info" id="pageInfo">–</span>' +
          '<button id="nextPage" title="Nächste Seite"><svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>'
          : '') +
        '<button id="zoomOut">−</button>' +
        '<span class="info" id="zoomInfo">100%</span>' +
        '<button id="zoomIn">+</button>' +
        '<button id="zoomFit">Fit</button>' +
        '<div class="spacer"></div>' +
        '<button id="fullscreen" title="Vollbild (F11)"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg> Vollbild</button>' +
      '</div>' +
      '<div class="wrap" id="wrap"><div class="loading"><div class="spinner"></div><div>Lade…</div></div></div>' +
      '</body></html>';

    extWin.document.open();
    extWin.document.write(htmlDoc);
    extWin.document.close();

    // Nach dem Schreiben: Viewer im externen Fenster starten
    extWin.addEventListener('load', function() {
      initExternalViewer(extWin, fileId, kind, fileName);
    });

    // Fallback falls load-Event nicht feuert (schon geladen)
    setTimeout(function() {
      if (extWin.document && extWin.document.getElementById('wrap') && extWin.document.getElementById('wrap').querySelector('.loading')) {
        initExternalViewer(extWin, fileId, kind, fileName);
      }
    }, 500);
  }

  // ─── Viewer-Logik im externen Fenster ───
  function initExternalViewer(extWin, fileId, kind, fileName) {
    var extDoc = extWin.document;
    var wrap = extDoc.getElementById('wrap');
    if (!wrap) return;

    var state = { pdf: null, page: 1, zoom: 1.0, blobUrl: null };

    function updatePageInfo() {
      var el = extDoc.getElementById('pageInfo');
      if (el && state.pdf) el.textContent = state.page + ' / ' + state.pdf.numPages;
    }

    function updateZoomInfo() {
      var el = extDoc.getElementById('zoomInfo');
      if (el) el.textContent = Math.round(state.zoom * 100) + '%';
    }

    function renderExtPage(pdf, pageNum, canvas, zoom) {
      return pdf.getPage(pageNum).then(function(page) {
        var dpr = extWin.devicePixelRatio || 1;
        var renderScale = zoom * 2.0 * dpr;
        var viewport = page.getViewport({ scale: renderScale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = (viewport.width / (2.0 * dpr)) + 'px';
        canvas.style.height = (viewport.height / (2.0 * dpr)) + 'px';
        return page.render({
          canvasContext: canvas.getContext('2d'),
          viewport: viewport,
        }).promise;
      });
    }

    function renderAllPages(pdf) {
      wrap.innerHTML = '';
      state.page = 1;
      var promises = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        (function(n) {
          var c = extDoc.createElement('canvas');
          c.className = 'page';
          c.id = 'extPage' + n;
          wrap.appendChild(c);
          promises.push(renderExtPage(pdf, n, c, state.zoom));
        })(i);
      }
      updatePageInfo();
      updateZoomInfo();
      return Promise.all(promises);
    }

    function rerender() {
      if (!state.pdf) return;
      var top = wrap.scrollTop;
      renderAllPages(state.pdf).then(function() { wrap.scrollTop = top; });
    }

    // Toolbar-Events
    var btn;
    btn = extDoc.getElementById('zoomIn'); if (btn) btn.onclick = function() {
      state.zoom = Math.min(state.zoom + 0.15, 4);
      updateZoomInfo();
      if (state.pdf) rerender();
      else { var img = wrap.querySelector('.image'); if (img) img.style.transform = 'scale(' + state.zoom + ')'; }
    };
    btn = extDoc.getElementById('zoomOut'); if (btn) btn.onclick = function() {
      state.zoom = Math.max(state.zoom - 0.15, 0.3);
      updateZoomInfo();
      if (state.pdf) rerender();
      else { var img = wrap.querySelector('.image'); if (img) img.style.transform = 'scale(' + state.zoom + ')'; }
    };
    btn = extDoc.getElementById('zoomFit'); if (btn) btn.onclick = function() {
      state.zoom = 1.0;
      updateZoomInfo();
      if (state.pdf) rerender();
      else { var img = wrap.querySelector('.image'); if (img) img.style.transform = 'scale(1)'; }
    };
    btn = extDoc.getElementById('prevPage'); if (btn) btn.onclick = function() {
      if (state.page > 1) {
        state.page--;
        var t = extDoc.getElementById('extPage' + state.page);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updatePageInfo();
      }
    };
    btn = extDoc.getElementById('nextPage'); if (btn) btn.onclick = function() {
      if (state.pdf && state.page < state.pdf.numPages) {
        state.page++;
        var t = extDoc.getElementById('extPage' + state.page);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updatePageInfo();
      }
    };
    btn = extDoc.getElementById('fullscreen'); if (btn) btn.onclick = function() {
      if (extDoc.documentElement.requestFullscreen) {
        extDoc.documentElement.requestFullscreen();
      }
    };

    // Cleanup beim Schließen
    extWin.addEventListener('beforeunload', function() {
      if (state.blobUrl) try { extWin.URL.revokeObjectURL(state.blobUrl); } catch(e){}
    });

    // Datei laden (Download-URL holen → Blob → rendern)
    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.blob();
    }).then(function(blob) {
      state.blobUrl = URL.createObjectURL(blob);

      if (kind === 'image') {
        wrap.innerHTML = '';
        var img = extDoc.createElement('img');
        img.className = 'image';
        img.src = state.blobUrl;
        wrap.appendChild(img);
        var pp = extDoc.getElementById('prevPage');
        var np = extDoc.getElementById('nextPage');
        var pi = extDoc.getElementById('pageInfo');
        if (pp) pp.style.display = 'none';
        if (np) np.style.display = 'none';
        if (pi) pi.style.display = 'none';
        return;
      }

      return loadPdfJs().then(function() {
        return blob.arrayBuffer();
      }).then(function(buf) {
        return _pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function(pdf) {
        state.pdf = pdf;
        return renderAllPages(pdf);
      });
    }).catch(function(e) {
      wrap.innerHTML = '<div class="error">Fehler beim Laden:<br>' + escHtml(e.message) + '</div>';
    });
  }

  // ─── Dropdown-Management ───
  function toggleDropdown() {
    var dd = document.getElementById('sl-detach-dropdown');
    if (!dd) return;
    dd.classList.toggle('open');
  }

  function closeDropdown() {
    var dd = document.getElementById('sl-detach-dropdown');
    if (dd) dd.classList.remove('open');
  }

  // ─── Drag für Floating-Fenster ───
  function setupDrag(floating) {
    var header = document.getElementById('sl-floating-header');
    if (!header) return;
    var dragging = false, offsetX = 0, offsetY = 0;

    header.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      var rect = floating.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      floating.style.left = (e.clientX - offsetX) + 'px';
      floating.style.top = (e.clientY - offsetY) + 'px';
    });

    document.addEventListener('mouseup', function() {
      dragging = false;
      document.body.style.userSelect = '';
    });
  }

  // ─── Toolbar-Events binden ───
  function bindToolbarEvents() {
    var btn;
    btn = document.getElementById('sl-prev-page'); if (btn) btn.onclick = prevPage;
    btn = document.getElementById('sl-next-page'); if (btn) btn.onclick = nextPage;
    btn = document.getElementById('sl-zoom-in'); if (btn) btn.onclick = zoomIn;
    btn = document.getElementById('sl-zoom-out'); if (btn) btn.onclick = zoomOut;
    btn = document.getElementById('sl-zoom-fit'); if (btn) btn.onclick = zoomFit;

    btn = document.getElementById('sl-detach-btn'); if (btn) btn.onclick = function(e) {
      e.stopPropagation();
      toggleDropdown();
    };
    btn = document.getElementById('sl-detach-floating'); if (btn) btn.onclick = function() {
      detachFloating();
    };
    btn = document.getElementById('sl-detach-external'); if (btn) btn.onclick = function() {
      detachExternal();
    };

    btn = document.getElementById('sl-download'); if (btn) btn.onclick = function() {
      if (_currentFile) {
        var idx = allFiles.indexOf(_currentFile);
        if (idx >= 0 && typeof downloadFile === 'function') downloadFile(idx);
      }
    };

    // Dropdown schließen bei Klick außerhalb
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('sl-detach-dropdown');
      if (dd && !dd.contains(e.target)) closeDropdown();
    });
  }

  function cleanupCurrentBlob() {
    if (_currentBlobUrl) {
      try { URL.revokeObjectURL(_currentBlobUrl); } catch(e) {}
      _currentBlobUrl = null;
    }
  }

  function openInViewer(file) {
    if (!file) return false;
    injectStyles();
    var kind = getFileKind(file.name);
    if (kind !== 'pdf' && kind !== 'image') return false;

    cleanupCurrentBlob();
    _currentFile = file;
    _currentPdf = null;
    _currentPage = 1;
    _currentZoom = 1.0;

    var panel = document.getElementById('previewPanel');
    var handle = document.getElementById('previewResizeHandle');
    var bodyEl = document.getElementById('previewBody');
    var titleEl = document.getElementById('previewTitle');
    var metaEl = document.getElementById('previewMeta');
    var zoomToolbar = document.getElementById('zoomToolbar');

    if (!panel || !bodyEl) return false;

    if (!_isDetached) {
      panel.classList.add('open');
      if (handle) handle.style.display = '';
    }

    if (titleEl) titleEl.textContent = file.name || 'Vorschau';
    if (metaEl) metaEl.style.display = 'none';
    if (zoomToolbar) zoomToolbar.style.display = 'none';

    var container = document.createElement('div');
    container.className = 'sl-viewer-container';
    container.innerHTML = buildViewerHTML(kind);

    var target = _isDetached && _detachedContainer
      ? document.getElementById('sl-floating-body')
      : bodyEl;
    target.innerHTML = '';
    target.appendChild(container);

    bindToolbarEvents();

    var wrap = document.getElementById('sl-canvas-wrap');
    var fileId = getFileId(file);
    if (!fileId) {
      wrap.innerHTML = '<div class="sl-viewer-error">Fehler: Keine Datei-ID</div>';
      return true;
    }

    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.blob();
    }).then(function(blob) {
      _currentBlobUrl = URL.createObjectURL(blob);

      if (kind === 'image') {
        wrap.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'sl-viewer-image';
        img.src = _currentBlobUrl;
        img.style.transformOrigin = 'center center';
        img.style.transition = 'transform .15s';
        wrap.appendChild(img);
        var pgi = document.getElementById('sl-page-info');
        if (pgi) pgi.style.display = 'none';
        var pp = document.getElementById('sl-prev-page');
        var np = document.getElementById('sl-next-page');
        if (pp) pp.style.display = 'none';
        if (np) np.style.display = 'none';
        return;
      }

      return loadPdfJs().then(function(lib) {
        return blob.arrayBuffer();
      }).then(function(buf) {
        return _pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function(pdf) {
        _currentPdf = pdf;
        return renderPdf(pdf, wrap);
      });
    }).catch(function(e) {
      console.error('[Viewer] Fehler:', e);
      wrap.innerHTML = '<div class="sl-viewer-error">Fehler beim Laden:<br>' + escHtml(e.message) + '</div>';
    });

    return true;
  }

  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;
    var handled = openInViewer(file);
    if (!handled && typeof _origOpenPreview === 'function') {
      _origOpenPreview(idx);
    }
  };

  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    cleanupCurrentBlob();
    _currentFile = null;
    _currentPdf = null;
    if (_isDetached) {
      closeFloating();
      return;
    }
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v2 geladen (HiDPI + Externes Fenster)');
})();
