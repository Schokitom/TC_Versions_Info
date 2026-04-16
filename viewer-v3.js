// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v3
// ═══════════════════════════════════════════════════════════════
//
//  Verbesserungen gegenüber v2:
//  - Scharfes PDF-Rendering (Multi-Layer-Strategie)
//  - Strg+Mausrad = Zoom
//  - Mittlere Maustaste halten = Verschieben (Pan)
//  - Abgekoppeltes Fenster bleibt offen und aktualisiert sich
//    bei jedem neuen Vorschau-Klick (Continuous Preview Mode)
//  - Floating-Fenster entfernt (vereinfacht UX)
//
//  Integration: <script src="viewer-v3.js"></script>
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
  var _currentBlobUrl = null;
  var _externalWindow = null;
  var _pageOriginalViewports = {}; // Cache für Original-Viewport pro Seite

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
      '.sl-viewer-btn.active { background: #005f8a; color: #fff; border-color: #00c2ff; }' +
      '.sl-viewer-page-info { font-family: var(--font, monospace); font-size: 11px; color: #7a8199; padding: 0 4px; min-width: 60px; text-align: center; }' +
      '.sl-viewer-zoom-info { font-family: var(--font, monospace); font-size: 11px; color: #7a8199; min-width: 45px; text-align: center; cursor: pointer; user-select: none; }' +
      '.sl-viewer-zoom-info:hover { color: #00c2ff; }' +
      '.sl-viewer-spacer { flex: 1; }' +
      '.sl-viewer-canvas-wrap { flex: 1; overflow: auto; background: #2a2d3e; display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; cursor: default; }' +
      '.sl-viewer-canvas-wrap.panning { cursor: grabbing; user-select: none; }' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar { width: 10px; height: 10px; }' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar-thumb { background: #555; border-radius: 5px; }' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar-thumb:hover { background: #777; }' +
      '.sl-viewer-page-container { padding: 12px 0; display: flex; flex-direction: column; align-items: center; gap: 10px; min-width: 100%; min-height: 100%; }' +
      '.sl-viewer-page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.4); display: block; }' +
      '.sl-viewer-image { display: block; box-shadow: 0 2px 8px rgba(0,0,0,.4); image-rendering: -webkit-optimize-contrast; transform-origin: center center; }' +
      '.sl-viewer-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #7a8199; gap: 12px; padding: 40px; }' +
      '.sl-viewer-spinner { width: 36px; height: 36px; border: 3px solid #2a2d3e; border-top-color: #00c2ff; border-radius: 50%; animation: sl-spin .7s linear infinite; }' +
      '@keyframes sl-spin { to { transform: rotate(360deg); } }' +
      '.sl-viewer-error { color: #ef4444; padding: 20px; text-align: center; font-size: 12px; }' +
      '.sl-hint { font-size: 10px; color: #555; padding: 4px 10px; text-align: center; background: #0f1117; border-top: 1px solid #2a2d3e; }';
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

    var externalBtnLabel = _externalWindow && !_externalWindow.closed ? 'Externes Fenster aktiv' : 'Abkoppeln';
    var externalBtnClass = _externalWindow && !_externalWindow.closed ? 'sl-viewer-btn active' : 'sl-viewer-btn';

    return '' +
      '<div class="sl-viewer-toolbar">' +
        pdfControls +
        '<button class="sl-viewer-btn" id="sl-zoom-out" title="Verkleinern (Strg+-)">−</button>' +
        '<span class="sl-viewer-zoom-info" id="sl-zoom-info" title="Klicken = 100%">100%</span>' +
        '<button class="sl-viewer-btn" id="sl-zoom-in" title="Vergrößern (Strg++)">+</button>' +
        '<button class="sl-viewer-btn" id="sl-zoom-fit" title="Seitenbreite">Fit</button>' +
        '<div class="sl-viewer-spacer"></div>' +
        '<button class="' + externalBtnClass + '" id="sl-detach-external" title="Externes Fenster öffnen/aktivieren">' +
          '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg>' +
          '<span id="sl-detach-label">' + externalBtnLabel + '</span>' +
        '</button>' +
        '<button class="sl-viewer-btn" id="sl-download" title="Download">' +
          '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="sl-viewer-canvas-wrap" id="sl-canvas-wrap">' +
        '<div class="sl-viewer-page-container" id="sl-page-container">' +
          '<div class="sl-viewer-loading"><div class="sl-viewer-spinner"></div><div>Lade…</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="sl-hint">Strg+Mausrad = Zoom · Mittlere Maustaste halten = Verschieben</div>';
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOCHAUFLÖSENDES PDF-RENDERING
  // ═══════════════════════════════════════════════════════════════
  function renderPdfPage(pdf, pageNum, canvas, zoom) {
    return pdf.getPage(pageNum).then(function(page) {
      var dpr = window.devicePixelRatio || 1;

      // Basis-Viewport (100% Zoom, ohne DPR)
      var baseViewport = page.getViewport({ scale: 1.0 });
      _pageOriginalViewports[pageNum] = baseViewport;

      // Render-Scale: hoch, damit Schrift scharf ist
      // Bei niedrigen Zooms trotzdem hoch rendern, damit Zoomen in die Cache
      // auch bei PDF-Viewer-Standard ist 72dpi → wir rendern mit Faktor 3
      var displayScale = zoom;
      var renderMultiplier = Math.max(3, displayScale * 3); // mindestens 3x
      var renderScale = renderMultiplier * dpr;

      var viewport = page.getViewport({ scale: renderScale });

      // Canvas physische Größe = gerenderte Pixel
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Canvas CSS-Größe = Zoom-abhängig
      var displayWidth = baseViewport.width * displayScale;
      var displayHeight = baseViewport.height * displayScale;
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';

      var ctx = canvas.getContext('2d');
      return page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;
    });
  }

  function renderPdf(pdf, targetContainer) {
    targetContainer.innerHTML = '';
    _currentPage = 1;
    _pageOriginalViewports = {};

    var renderPromises = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      (function(pageNum) {
        var canvas = document.createElement('canvas');
        canvas.className = 'sl-viewer-page';
        canvas.id = 'sl-page-' + pageNum;
        targetContainer.appendChild(canvas);
        renderPromises.push(renderPdfPage(pdf, pageNum, canvas, _currentZoom));
      })(i);
    }

    updatePageInfo();
    updateZoomInfo();
    return Promise.all(renderPromises);
  }

  function updateCanvasSizes() {
    // Nur CSS-Größe neu setzen, Canvas selbst nicht neu rendern
    // (das würde Performance kosten und Qualität verlieren)
    if (!_currentPdf) return;
    for (var i = 1; i <= _currentPdf.numPages; i++) {
      var canvas = document.getElementById('sl-page-' + i);
      var baseVp = _pageOriginalViewports[i];
      if (canvas && baseVp) {
        canvas.style.width = (baseVp.width * _currentZoom) + 'px';
        canvas.style.height = (baseVp.height * _currentZoom) + 'px';
      }
    }
  }

  function rerenderAllPages() {
    if (!_currentPdf) return;
    var container = document.getElementById('sl-page-container');
    if (!container) return;
    var promises = [];
    for (var i = 1; i <= _currentPdf.numPages; i++) {
      var canvas = document.getElementById('sl-page-' + i);
      if (canvas) {
        promises.push(renderPdfPage(_currentPdf, i, canvas, _currentZoom));
      }
    }
    return Promise.all(promises);
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

  // ═══════════════════════════════════════════════════════════════
  //  ZOOM-LOGIK
  // ═══════════════════════════════════════════════════════════════
  var _zoomDebounce = null;

  function setZoom(newZoom, cursorX, cursorY) {
    _currentZoom = Math.max(0.3, Math.min(5, newZoom));
    updateZoomInfo();

    var wrap = document.getElementById('sl-canvas-wrap');

    // Sofort: CSS-Größe anpassen (fast aber unscharf beim Hochzoom)
    if (_currentPdf) {
      // Scroll-Position halten (auf Cursor zentriert wenn angegeben)
      var oldScrollLeft = wrap ? wrap.scrollLeft : 0;
      var oldScrollTop = wrap ? wrap.scrollTop : 0;

      updateCanvasSizes();

      // Debounced: Hochqualitativ nachrendern
      if (_zoomDebounce) clearTimeout(_zoomDebounce);
      _zoomDebounce = setTimeout(function() {
        rerenderAllPages();
      }, 300);
    } else {
      applyImageZoom();
    }
  }

  function zoomIn() { setZoom(_currentZoom + 0.15); }
  function zoomOut() { setZoom(_currentZoom - 0.15); }
  function zoomFit() { setZoom(1.0); }

  function applyImageZoom() {
    var img = document.querySelector('.sl-viewer-image');
    if (img) img.style.transform = 'scale(' + _currentZoom + ')';
  }

  // ═══════════════════════════════════════════════════════════════
  //  STRG+MAUSRAD ZOOM
  // ═══════════════════════════════════════════════════════════════
  function setupWheelZoom(wrap) {
    wrap.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();

      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      var newZoom = _currentZoom + delta;
      setZoom(newZoom);
    }, { passive: false });
  }

  // ═══════════════════════════════════════════════════════════════
  //  MITTLERE MAUSTASTE = PAN (Verschieben)
  // ═══════════════════════════════════════════════════════════════
  function setupMiddleMousePan(wrap) {
    var panning = false;
    var startX = 0, startY = 0;
    var startScrollLeft = 0, startScrollTop = 0;

    wrap.addEventListener('mousedown', function(e) {
      if (e.button !== 1) return; // nur mittlere Maustaste
      e.preventDefault();
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = wrap.scrollLeft;
      startScrollTop = wrap.scrollTop;
      wrap.classList.add('panning');
    });

    document.addEventListener('mousemove', function(e) {
      if (!panning) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      wrap.scrollLeft = startScrollLeft - dx;
      wrap.scrollTop = startScrollTop - dy;
    });

    document.addEventListener('mouseup', function(e) {
      if (panning) {
        panning = false;
        wrap.classList.remove('panning');
      }
    });

    // AutoScroll-Symbol von Mittelklick unterdrücken
    wrap.addEventListener('auxclick', function(e) {
      if (e.button === 1) e.preventDefault();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER (Continuous Preview)
  // ═══════════════════════════════════════════════════════════════
  function toggleExternalWindow() {
    if (_externalWindow && !_externalWindow.closed) {
      // Fenster schon offen → schließen
      _externalWindow.close();
      _externalWindow = null;
      updateDetachButton();
      // Inline-Viewer wieder einblenden
      var panel = document.getElementById('previewPanel');
      var handle = document.getElementById('previewResizeHandle');
      if (panel) panel.classList.add('open');
      if (handle) handle.style.display = '';
      // Aktuelles File neu laden (Inline)
      if (_currentFile) openInViewer(_currentFile);
      return;
    }

    // Neues externes Fenster öffnen
    openExternalWindow();

    // Inline-Viewer ausblenden
    var panel = document.getElementById('previewPanel');
    var handle = document.getElementById('previewResizeHandle');
    if (panel) panel.classList.remove('open');
    if (handle) handle.style.display = 'none';
  }

  function openExternalWindow() {
    var features = 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';
    var extWin = window.open('', 'sl-viewer-ext', features);

    if (!extWin) {
      alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
      return;
    }

    _externalWindow = extWin;

    // HTML für externes Fenster schreiben
    var htmlDoc = buildExternalWindowHTML();
    extWin.document.open();
    extWin.document.write(htmlDoc);
    extWin.document.close();

    // Event-Handler im externen Fenster einrichten
    extWin.addEventListener('load', function() {
      setupExternalWindowHandlers(extWin);
      // Wenn bereits ein File geöffnet war, direkt darstellen
      if (_currentFile) {
        loadFileInExternal(_currentFile);
      } else {
        showExternalPlaceholder();
      }
    });

    // Fallback falls load nicht feuert
    setTimeout(function() {
      if (extWin.document && !extWin.__initialized) {
        setupExternalWindowHandlers(extWin);
        if (_currentFile) loadFileInExternal(_currentFile);
        else showExternalPlaceholder();
      }
    }, 300);

    // Erkennen wenn Fenster geschlossen wird
    var checkClosed = setInterval(function() {
      if (!_externalWindow || _externalWindow.closed) {
        clearInterval(checkClosed);
        _externalWindow = null;
        updateDetachButton();
        // Inline-Viewer wieder zeigen
        var panel = document.getElementById('previewPanel');
        var handle = document.getElementById('previewResizeHandle');
        if (panel && _currentFile) {
          panel.classList.add('open');
          if (handle) handle.style.display = '';
          openInViewer(_currentFile);
        }
      }
    }, 500);

    updateDetachButton();
  }

  function updateDetachButton() {
    var btn = document.getElementById('sl-detach-external');
    var label = document.getElementById('sl-detach-label');
    if (!btn || !label) return;
    if (_externalWindow && !_externalWindow.closed) {
      btn.classList.add('active');
      label.textContent = 'Wieder andocken';
    } else {
      btn.classList.remove('active');
      label.textContent = 'Abkoppeln';
    }
  }

  function buildExternalWindowHTML() {
    return '<!DOCTYPE html><html lang="de"><head>' +
      '<meta charset="UTF-8">' +
      '<title>S+L Viewer</title>' +
      '<style>' +
        '* { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { background: #1a1d27; color: #e4e8f0; font-family: "DM Sans", "Segoe UI", sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }' +
        '.toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #0f1117; border-bottom: 1px solid #2a2d3e; flex-shrink: 0; }' +
        '.title { flex: 1; font-size: 13px; font-weight: 600; color: #e4e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 8px; }' +
        '.logo { width: 20px; height: 20px; }' +
        'button { background: none; border: 1px solid #2a2d3e; border-radius: 4px; color: #7a8199; cursor: pointer; padding: 4px 10px; font-size: 12px; font-family: inherit; display: inline-flex; align-items: center; gap: 4px; transition: all .15s; }' +
        'button:hover:not(:disabled) { border-color: #00c2ff; color: #00c2ff; background: #1e2235; }' +
        'button:disabled { opacity: .4; cursor: not-allowed; }' +
        'button svg { width: 14px; height: 14px; fill: currentColor; }' +
        '.info { font-family: "DM Mono", monospace; font-size: 12px; color: #7a8199; padding: 0 6px; min-width: 50px; text-align: center; cursor: pointer; user-select: none; }' +
        '.info:hover { color: #00c2ff; }' +
        '.spacer { flex: 1; }' +
        '.wrap { flex: 1; overflow: auto; background: #2a2d3e; position: relative; }' +
        '.wrap.panning { cursor: grabbing; user-select: none; }' +
        '.wrap::-webkit-scrollbar { width: 10px; height: 10px; }' +
        '.wrap::-webkit-scrollbar-thumb { background: #555; border-radius: 5px; }' +
        '.wrap::-webkit-scrollbar-thumb:hover { background: #777; }' +
        '.page-container { padding: 16px 0; display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 100%; min-height: 100%; }' +
        '.page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.5); display: block; }' +
        '.image { display: block; box-shadow: 0 2px 8px rgba(0,0,0,.5); image-rendering: -webkit-optimize-contrast; transform-origin: center center; }' +
        '.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #7a8199; gap: 12px; padding: 40px; }' +
        '.spinner { width: 40px; height: 40px; border: 3px solid #2a2d3e; border-top-color: #00c2ff; border-radius: 50%; animation: spin .7s linear infinite; }' +
        '@keyframes spin { to { transform: rotate(360deg); } }' +
        '.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #7a8199; gap: 16px; padding: 40px; text-align: center; }' +
        '.placeholder svg { width: 64px; height: 64px; opacity: .3; fill: currentColor; }' +
        '.error { color: #ef4444; padding: 20px; text-align: center; }' +
        '.hint { padding: 4px 12px; background: #0f1117; color: #7a8199; font-size: 10px; text-align: center; border-top: 1px solid #2a2d3e; }' +
      '</style>' +
      '</head><body>' +
      '<div class="toolbar">' +
        '<svg class="logo" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title" id="extTitle">Warte auf Auswahl…</div>' +
        '<button id="extPrevPage" title="Vorherige Seite" style="display:none"><svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
        '<span class="info" id="extPageInfo" style="display:none">–</span>' +
        '<button id="extNextPage" title="Nächste Seite" style="display:none"><svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>' +
        '<button id="extZoomOut" title="Verkleinern">−</button>' +
        '<span class="info" id="extZoomInfo" title="Klicken = 100%">100%</span>' +
        '<button id="extZoomIn" title="Vergrößern">+</button>' +
        '<button id="extZoomFit">Fit</button>' +
        '<div class="spacer"></div>' +
        '<button id="extFullscreen" title="Vollbild (F11)"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg> Vollbild</button>' +
      '</div>' +
      '<div class="wrap" id="extWrap">' +
        '<div class="placeholder">' +
          '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>' +
          '<div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div>' +
        '</div>' +
      '</div>' +
      '<div class="hint">Strg+Mausrad = Zoom · Mittlere Maustaste halten = Verschieben · F11 = Vollbild</div>' +
      '</body></html>';
  }

  function showExternalPlaceholder() {
    if (!_externalWindow || _externalWindow.closed) return;
    var doc = _externalWindow.document;
    var wrap = doc.getElementById('extWrap');
    var title = doc.getElementById('extTitle');
    if (wrap) {
      wrap.innerHTML =
        '<div class="placeholder">' +
          '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>' +
          '<div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div>' +
        '</div>';
    }
    if (title) title.textContent = 'Warte auf Auswahl…';
  }

  function setupExternalWindowHandlers(extWin) {
    if (extWin.__initialized) return;
    extWin.__initialized = true;

    var doc = extWin.document;
    var state = {
      pdf: null,
      page: 1,
      zoom: 1.0,
      blobUrl: null,
      kind: null,
      origViewports: {},
    };
    extWin.__state = state;

    var zoomDebounce = null;

    function renderExtPage(pageNum, canvas, zoom) {
      return state.pdf.getPage(pageNum).then(function(page) {
        var dpr = extWin.devicePixelRatio || 1;
        var baseViewport = page.getViewport({ scale: 1.0 });
        state.origViewports[pageNum] = baseViewport;

        var renderMultiplier = Math.max(3, zoom * 3);
        var renderScale = renderMultiplier * dpr;
        var viewport = page.getViewport({ scale: renderScale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = (baseViewport.width * zoom) + 'px';
        canvas.style.height = (baseViewport.height * zoom) + 'px';

        return page.render({
          canvasContext: canvas.getContext('2d'),
          viewport: viewport,
        }).promise;
      });
    }

    function renderAllPages() {
      if (!state.pdf) return Promise.resolve();
      var wrap = doc.getElementById('extWrap');
      wrap.innerHTML = '<div class="page-container" id="extPageContainer"></div>';
      var container = doc.getElementById('extPageContainer');
      state.page = 1;
      state.origViewports = {};
      var promises = [];
      for (var i = 1; i <= state.pdf.numPages; i++) {
        (function(n) {
          var c = doc.createElement('canvas');
          c.className = 'page';
          c.id = 'extPage' + n;
          container.appendChild(c);
          promises.push(renderExtPage(n, c, state.zoom));
        })(i);
      }
      updatePageInfo();
      updateZoomInfo();
      return Promise.all(promises);
    }

    function updateCanvasSizesOnly() {
      if (!state.pdf) return;
      for (var i = 1; i <= state.pdf.numPages; i++) {
        var canvas = doc.getElementById('extPage' + i);
        var baseVp = state.origViewports[i];
        if (canvas && baseVp) {
          canvas.style.width = (baseVp.width * state.zoom) + 'px';
          canvas.style.height = (baseVp.height * state.zoom) + 'px';
        }
      }
    }

    function rerenderAll() {
      if (!state.pdf) return;
      var promises = [];
      for (var i = 1; i <= state.pdf.numPages; i++) {
        var c = doc.getElementById('extPage' + i);
        if (c) promises.push(renderExtPage(i, c, state.zoom));
      }
      return Promise.all(promises);
    }

    function updatePageInfo() {
      var el = doc.getElementById('extPageInfo');
      if (el && state.pdf) el.textContent = state.page + ' / ' + state.pdf.numPages;
    }

    function updateZoomInfo() {
      var el = doc.getElementById('extZoomInfo');
      if (el) el.textContent = Math.round(state.zoom * 100) + '%';
    }

    function setZoomExt(newZoom) {
      state.zoom = Math.max(0.3, Math.min(5, newZoom));
      updateZoomInfo();
      if (state.pdf) {
        updateCanvasSizesOnly();
        if (zoomDebounce) clearTimeout(zoomDebounce);
        zoomDebounce = setTimeout(rerenderAll, 300);
      } else {
        var img = doc.querySelector('.image');
        if (img) img.style.transform = 'scale(' + state.zoom + ')';
      }
    }

    // Toolbar-Events
    var btn;
    btn = doc.getElementById('extZoomIn'); if (btn) btn.onclick = function() { setZoomExt(state.zoom + 0.15); };
    btn = doc.getElementById('extZoomOut'); if (btn) btn.onclick = function() { setZoomExt(state.zoom - 0.15); };
    btn = doc.getElementById('extZoomFit'); if (btn) btn.onclick = function() { setZoomExt(1.0); };
    btn = doc.getElementById('extZoomInfo'); if (btn) btn.onclick = function() { setZoomExt(1.0); };

    btn = doc.getElementById('extPrevPage'); if (btn) btn.onclick = function() {
      if (state.page > 1) {
        state.page--;
        var t = doc.getElementById('extPage' + state.page);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updatePageInfo();
      }
    };
    btn = doc.getElementById('extNextPage'); if (btn) btn.onclick = function() {
      if (state.pdf && state.page < state.pdf.numPages) {
        state.page++;
        var t = doc.getElementById('extPage' + state.page);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updatePageInfo();
      }
    };
    btn = doc.getElementById('extFullscreen'); if (btn) btn.onclick = function() {
      if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen();
    };

    // Strg+Mausrad Zoom
    var wrap = doc.getElementById('extWrap');
    wrap.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoomExt(state.zoom + delta);
    }, { passive: false });

    // Mittlere Maustaste Pan
    var panning = false, startX = 0, startY = 0, startSL = 0, startST = 0;
    wrap.addEventListener('mousedown', function(e) {
      if (e.button !== 1) return;
      e.preventDefault();
      panning = true;
      startX = e.clientX; startY = e.clientY;
      startSL = wrap.scrollLeft; startST = wrap.scrollTop;
      wrap.classList.add('panning');
    });
    doc.addEventListener('mousemove', function(e) {
      if (!panning) return;
      wrap.scrollLeft = startSL - (e.clientX - startX);
      wrap.scrollTop = startST - (e.clientY - startY);
    });
    doc.addEventListener('mouseup', function() {
      if (panning) { panning = false; wrap.classList.remove('panning'); }
    });
    wrap.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });

    // Expose render function für loadFileInExternal
    extWin.__render = {
      renderAllPages: renderAllPages,
      state: state,
    };
  }

  function loadFileInExternal(file) {
    if (!_externalWindow || _externalWindow.closed) return;
    if (!_externalWindow.__initialized) {
      setupExternalWindowHandlers(_externalWindow);
    }

    var doc = _externalWindow.document;
    var wrap = doc.getElementById('extWrap');
    var title = doc.getElementById('extTitle');
    var state = _externalWindow.__state;
    if (!wrap || !state) {
      setTimeout(function() { loadFileInExternal(file); }, 200);
      return;
    }

    if (title) title.textContent = file.name || 'Datei';

    // Loading
    wrap.innerHTML = '<div class="loading"><div class="spinner"></div><div>Lade…</div></div>';

    // Kontrollen zurücksetzen
    var kind = getFileKind(file.name);
    state.kind = kind;
    state.pdf = null;
    state.page = 1;
    state.zoom = 1.0;
    state.origViewports = {};

    // UI-Elemente ein/ausblenden je nach Typ
    var pp = doc.getElementById('extPrevPage');
    var np = doc.getElementById('extNextPage');
    var pi = doc.getElementById('extPageInfo');
    if (pp) pp.style.display = kind === 'pdf' ? '' : 'none';
    if (np) np.style.display = kind === 'pdf' ? '' : 'none';
    if (pi) pi.style.display = kind === 'pdf' ? '' : 'none';

    var zi = doc.getElementById('extZoomInfo');
    if (zi) zi.textContent = '100%';

    var fileId = getFileId(file);
    if (!fileId) {
      wrap.innerHTML = '<div class="error">Fehler: Keine Datei-ID</div>';
      return;
    }

    if (kind !== 'pdf' && kind !== 'image') {
      wrap.innerHTML =
        '<div class="placeholder">' +
          '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z"/></svg>' +
          '<div>Dieser Dateityp wird vom externen Viewer nicht unterstützt.<br>Nur PDFs und Bilder.</div>' +
        '</div>';
      return;
    }

    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.blob();
    }).then(function(blob) {
      if (state.blobUrl) {
        try { _externalWindow.URL.revokeObjectURL(state.blobUrl); } catch(e){}
      }
      state.blobUrl = URL.createObjectURL(blob);

      if (kind === 'image') {
        wrap.innerHTML = '<div class="page-container"></div>';
        var container = wrap.querySelector('.page-container');
        var img = doc.createElement('img');
        img.className = 'image';
        img.src = state.blobUrl;
        container.appendChild(img);
        return;
      }

      return loadPdfJs().then(function() {
        return blob.arrayBuffer();
      }).then(function(buf) {
        return _pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function(pdf) {
        state.pdf = pdf;
        if (_externalWindow.__render) {
          return _externalWindow.__render.renderAllPages();
        }
      });
    }).catch(function(e) {
      console.error('[ExtViewer] Fehler:', e);
      wrap.innerHTML = '<div class="error">Fehler beim Laden:<br>' + escHtml(e.message) + '</div>';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Toolbar-Events
  // ═══════════════════════════════════════════════════════════════
  function bindToolbarEvents() {
    var btn;
    btn = document.getElementById('sl-prev-page'); if (btn) btn.onclick = prevPage;
    btn = document.getElementById('sl-next-page'); if (btn) btn.onclick = nextPage;
    btn = document.getElementById('sl-zoom-in'); if (btn) btn.onclick = zoomIn;
    btn = document.getElementById('sl-zoom-out'); if (btn) btn.onclick = zoomOut;
    btn = document.getElementById('sl-zoom-fit'); if (btn) btn.onclick = zoomFit;
    btn = document.getElementById('sl-zoom-info'); if (btn) btn.onclick = zoomFit;

    btn = document.getElementById('sl-detach-external'); if (btn) btn.onclick = toggleExternalWindow;

    btn = document.getElementById('sl-download'); if (btn) btn.onclick = function() {
      if (_currentFile) {
        var idx = allFiles.indexOf(_currentFile);
        if (idx >= 0 && typeof downloadFile === 'function') downloadFile(idx);
      }
    };

    var wrap = document.getElementById('sl-canvas-wrap');
    if (wrap) {
      setupWheelZoom(wrap);
      setupMiddleMousePan(wrap);
    }
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

    _currentFile = file;

    // Falls externes Fenster aktiv: dort laden, Inline überspringen
    if (_externalWindow && !_externalWindow.closed) {
      loadFileInExternal(file);
      return true;
    }

    cleanupCurrentBlob();
    _currentPdf = null;
    _currentPage = 1;
    _currentZoom = 1.0;
    _pageOriginalViewports = {};

    var panel = document.getElementById('previewPanel');
    var handle = document.getElementById('previewResizeHandle');
    var bodyEl = document.getElementById('previewBody');
    var titleEl = document.getElementById('previewTitle');
    var metaEl = document.getElementById('previewMeta');
    var zoomToolbar = document.getElementById('zoomToolbar');

    if (!panel || !bodyEl) return false;

    panel.classList.add('open');
    if (handle) handle.style.display = '';

    if (titleEl) titleEl.textContent = file.name || 'Vorschau';
    if (metaEl) metaEl.style.display = 'none';
    if (zoomToolbar) zoomToolbar.style.display = 'none';

    var container = document.createElement('div');
    container.className = 'sl-viewer-container';
    container.innerHTML = buildViewerHTML(kind);

    bodyEl.innerHTML = '';
    bodyEl.appendChild(container);

    bindToolbarEvents();

    var wrap = document.getElementById('sl-canvas-wrap');
    var pageContainer = document.getElementById('sl-page-container');

    var fileId = getFileId(file);
    if (!fileId) {
      pageContainer.innerHTML = '<div class="sl-viewer-error">Fehler: Keine Datei-ID</div>';
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
        pageContainer.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'sl-viewer-image';
        img.src = _currentBlobUrl;
        img.style.transition = 'transform .15s';
        pageContainer.appendChild(img);
        var pgi = document.getElementById('sl-page-info');
        var pp = document.getElementById('sl-prev-page');
        var np = document.getElementById('sl-next-page');
        if (pgi) pgi.style.display = 'none';
        if (pp) pp.style.display = 'none';
        if (np) np.style.display = 'none';
        return;
      }

      return loadPdfJs().then(function() {
        return blob.arrayBuffer();
      }).then(function(buf) {
        return _pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function(pdf) {
        _currentPdf = pdf;
        return renderPdf(pdf, pageContainer);
      });
    }).catch(function(e) {
      console.error('[Viewer] Fehler:', e);
      pageContainer.innerHTML = '<div class="sl-viewer-error">Fehler beim Laden:<br>' + escHtml(e.message) + '</div>';
    });

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  openPreview-Hook
  // ═══════════════════════════════════════════════════════════════
  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;

    // Externes Fenster aktiv? → dort anzeigen
    if (_externalWindow && !_externalWindow.closed) {
      var kind = getFileKind(file.name);
      if (kind === 'pdf' || kind === 'image') {
        _currentFile = file;
        loadFileInExternal(file);
        return;
      }
    }

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
    // Externes Fenster NICHT schließen — wir zeigen Placeholder
    if (_externalWindow && !_externalWindow.closed) {
      showExternalPlaceholder();
    }
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v3 geladen (HiDPI + Continuous External Preview)');
})();
