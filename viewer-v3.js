// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v5
//  cMap + StandardFonts Fix für scharfe Textdarstellung
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
  var CMAP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/cmaps/';
  var FONT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/standard_fonts/';

  var _pdfjsLib = null;
  var _currentPdf = null;
  var _currentPage = 1;
  var _currentZoom = 1.0;
  var _fitZoom = 1.0;
  var _currentFile = null;
  var _currentBlobUrl = null;
  var _externalWindow = null;
  var _pageOriginalViewports = {};
  var _currentPdfBuffer = null; // ArrayBuffer für Wiederverwendung im externen Fenster

  function loadPdfJs() {
    if (_pdfjsLib) return Promise.resolve(_pdfjsLib);
    return import(PDFJS_URL).then(function(lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      _pdfjsLib = lib;
      return lib;
    });
  }

  // ═══ PDF laden MIT cMaps und StandardFonts ═══
  function loadPdfDocument(arrayBuffer) {
    return _pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: FONT_URL,
    }).promise;
  }

  function getDownloadUrl(fileId) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }).then(function(r) {
      if (!r.ok) throw new Error('Download-URL Fehler: ' + r.status);
      return r.json();
    }).then(function(data) {
      if (!data || !data.url) throw new Error('Keine Download-URL');
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
      '.sl-viewer-container{position:relative;width:100%;height:100%;background:#1a1d27;display:flex;flex-direction:column;overflow:hidden}' +
      '.sl-viewer-toolbar{display:flex;align-items:center;gap:4px;padding:6px 10px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0;flex-wrap:wrap}' +
      '.sl-viewer-btn{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:3px 8px;font-size:11px;font-family:var(--font-ui,sans-serif);display:inline-flex;align-items:center;gap:3px;transition:all .15s;white-space:nowrap}' +
      '.sl-viewer-btn:hover:not(:disabled){border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      '.sl-viewer-btn:disabled{opacity:.4;cursor:not-allowed}' +
      '.sl-viewer-btn svg{width:12px;height:12px;fill:currentColor}' +
      '.sl-viewer-btn.active{background:#005f8a;color:#fff;border-color:#00c2ff}' +
      '.sl-viewer-page-info{font-family:var(--font,monospace);font-size:11px;color:#7a8199;padding:0 4px;min-width:60px;text-align:center}' +
      '.sl-viewer-zoom-info{font-family:var(--font,monospace);font-size:11px;color:#7a8199;min-width:45px;text-align:center;cursor:pointer;user-select:none}' +
      '.sl-viewer-zoom-info:hover{color:#00c2ff}' +
      '.sl-viewer-spacer{flex:1}' +
      '.sl-viewer-canvas-wrap{flex:1;overflow:auto;background:#2a2d3e;position:relative;cursor:default}' +
      '.sl-viewer-canvas-wrap.panning{cursor:grabbing;user-select:none}' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar{width:10px;height:10px}' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar-thumb{background:#555;border-radius:5px}' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar-thumb:hover{background:#777}' +
      '.sl-viewer-page-container{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;min-width:min-content;min-height:min-content}' +
      '.sl-viewer-page{background:white;box-shadow:0 2px 12px rgba(0,0,0,.5);display:block}' +
      '.sl-viewer-image{display:block;box-shadow:0 2px 12px rgba(0,0,0,.5);image-rendering:-webkit-optimize-contrast}' +
      '.sl-viewer-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#7a8199;gap:12px;padding:40px}' +
      '.sl-viewer-spinner{width:36px;height:36px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:sl-spin .7s linear infinite}' +
      '@keyframes sl-spin{to{transform:rotate(360deg)}}' +
      '.sl-viewer-error{color:#ef4444;padding:20px;text-align:center;font-size:12px}' +
      '.sl-hint{font-size:10px;color:#555;padding:4px 10px;text-align:center;background:#0f1117;border-top:1px solid #2a2d3e;flex-shrink:0}';
    var style = document.createElement('style');
    style.id = 'sl-viewer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildViewerHTML(kind) {
    var pdfControls = kind === 'pdf' ?
      '<button class="sl-viewer-btn" id="sl-prev-page"><svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
      '<span class="sl-viewer-page-info" id="sl-page-info">–</span>' +
      '<button class="sl-viewer-btn" id="sl-next-page"><svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>'
      : '';

    var extLabel = _externalWindow && !_externalWindow.closed ? 'Wieder andocken' : 'Abkoppeln';
    var extClass = _externalWindow && !_externalWindow.closed ? 'sl-viewer-btn active' : 'sl-viewer-btn';

    return '<div class="sl-viewer-toolbar">' + pdfControls +
      '<button class="sl-viewer-btn" id="sl-zoom-out">−</button>' +
      '<span class="sl-viewer-zoom-info" id="sl-zoom-info" title="Klicken = Fit">100%</span>' +
      '<button class="sl-viewer-btn" id="sl-zoom-in">+</button>' +
      '<button class="sl-viewer-btn" id="sl-zoom-fit">Fit</button>' +
      '<button class="sl-viewer-btn" id="sl-zoom-100">100%</button>' +
      '<div class="sl-viewer-spacer"></div>' +
      '<button class="' + extClass + '" id="sl-detach-external"><svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg><span id="sl-detach-label">' + extLabel + '</span></button>' +
      '<button class="sl-viewer-btn" id="sl-download"><svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg></button>' +
      '</div>' +
      '<div class="sl-viewer-canvas-wrap" id="sl-canvas-wrap"><div class="sl-viewer-page-container" id="sl-page-container"><div class="sl-viewer-loading"><div class="sl-viewer-spinner"></div><div>Lade…</div></div></div></div>' +
      '<div class="sl-hint">Strg+Mausrad = Zoom · Mittlere Maustaste halten = Verschieben</div>';
  }

  // ═══════════════════════════════════════════════════════════════
  //  PDF-RENDERING — gleiche Logik für inline + extern
  // ═══════════════════════════════════════════════════════════════
  function renderPage(pdf, pageNum, canvas, displayZoom, targetDpr) {
    return pdf.getPage(pageNum).then(function(page) {
      var dpr = targetDpr || window.devicePixelRatio || 1;
      var baseViewport = page.getViewport({ scale: 1.0 });

      // ═══ RENDER-AUFLÖSUNG ═══
      // Bei kleinem Zoom (Fit): trotzdem mindestens 3x rendern für Schärfe
      // Bei großem Zoom: proportional hochskalieren
      var minMultiplier = 3;
      var renderMultiplier = Math.max(minMultiplier, displayZoom * 2.5) * dpr;

      var viewport = page.getViewport({ scale: renderMultiplier });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = (baseViewport.width * displayZoom) + 'px';
      canvas.style.height = (baseViewport.height * displayZoom) + 'px';

      return page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport,
      }).promise.then(function() {
        return baseViewport; // für Fit-Zoom Berechnung
      });
    });
  }

  function renderAllPages(pdf, container, zoom, wrapEl) {
    container.innerHTML = '';

    return pdf.getPage(1).then(function(firstPage) {
      var firstVp = firstPage.getViewport({ scale: 1.0 });

      // Fit-Zoom berechnen
      var availW = wrapEl ? wrapEl.clientWidth - 40 : 800;
      var availH = wrapEl ? wrapEl.clientHeight - 40 : 600;
      var fitX = availW / firstVp.width;
      var fitY = availH / firstVp.height;
      var fitZoom = Math.min(fitX, fitY);

      // Wenn kein expliziter Zoom → Fit
      var useZoom = zoom !== undefined && zoom !== null ? zoom : fitZoom;

      var pageViewports = {};
      var promises = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        (function(n) {
          var canvas = document.createElement('canvas');
          canvas.className = container.ownerDocument === document ? 'sl-viewer-page' : 'page';
          canvas.id = (container.ownerDocument === document ? 'sl-page-' : 'extPage') + n;
          container.appendChild(canvas);
          var dpr = (wrapEl && wrapEl.ownerDocument && wrapEl.ownerDocument.defaultView)
            ? (wrapEl.ownerDocument.defaultView.devicePixelRatio || 1)
            : (window.devicePixelRatio || 1);
          promises.push(renderPage(pdf, n, canvas, useZoom, dpr).then(function(baseVp) {
            pageViewports[n] = baseVp;
          }));
        })(i);
      }

      return Promise.all(promises).then(function() {
        return { fitZoom: fitZoom, zoom: useZoom, pageViewports: pageViewports };
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  INLINE VIEWER STATE
  // ═══════════════════════════════════════════════════════════════
  var _zoomDebounce = null;

  function updatePageInfo() {
    var el = document.getElementById('sl-page-info');
    if (el && _currentPdf) el.textContent = _currentPage + ' / ' + _currentPdf.numPages;
  }
  function updateZoomInfo() {
    var el = document.getElementById('sl-zoom-info');
    if (el) el.textContent = Math.round(_currentZoom * 100) + '%';
  }
  function scrollToPage(n) {
    var t = document.getElementById('sl-page-' + n);
    if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); _currentPage = n; updatePageInfo(); }
  }
  function prevPage() { if (_currentPage > 1) scrollToPage(_currentPage - 1); }
  function nextPage() { if (_currentPdf && _currentPage < _currentPdf.numPages) scrollToPage(_currentPage + 1); }

  function updateInlineCanvasSizes() {
    if (!_currentPdf) return;
    for (var i = 1; i <= _currentPdf.numPages; i++) {
      var c = document.getElementById('sl-page-' + i);
      var vp = _pageOriginalViewports[i];
      if (c && vp) { c.style.width = (vp.width * _currentZoom) + 'px'; c.style.height = (vp.height * _currentZoom) + 'px'; }
    }
  }

  function rerenderInline() {
    if (!_currentPdf) return;
    var container = document.getElementById('sl-page-container');
    var wrap = document.getElementById('sl-canvas-wrap');
    if (!container || !wrap) return;
    var promises = [];
    for (var i = 1; i <= _currentPdf.numPages; i++) {
      var c = document.getElementById('sl-page-' + i);
      if (c) promises.push(renderPage(_currentPdf, i, c, _currentZoom));
    }
    return Promise.all(promises);
  }

  function setZoom(newZoom) {
    _currentZoom = Math.max(0.1, Math.min(6, newZoom));
    updateZoomInfo();
    if (_currentPdf) {
      updateInlineCanvasSizes();
      if (_zoomDebounce) clearTimeout(_zoomDebounce);
      _zoomDebounce = setTimeout(rerenderInline, 250);
    } else {
      var img = document.querySelector('.sl-viewer-image');
      if (img) { img.style.width = (img.naturalWidth * _currentZoom) + 'px'; img.style.height = (img.naturalHeight * _currentZoom) + 'px'; }
    }
  }

  function zoomIn() { setZoom(_currentZoom * 1.15); }
  function zoomOut() { setZoom(_currentZoom / 1.15); }
  function zoomFit() { setZoom(_fitZoom); }
  function zoom100() { setZoom(1.0); }

  function setupWheelZoom(wrap) {
    wrap.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(_currentZoom * (e.deltaY > 0 ? 1 / 1.1 : 1.1));
    }, { passive: false });
  }

  function setupMiddleMousePan(wrap) {
    var panning = false, sx = 0, sy = 0, ssl = 0, sst = 0;
    wrap.addEventListener('mousedown', function(e) {
      if (e.button !== 1) return; e.preventDefault();
      panning = true; sx = e.clientX; sy = e.clientY; ssl = wrap.scrollLeft; sst = wrap.scrollTop;
      wrap.classList.add('panning');
    });
    document.addEventListener('mousemove', function(e) {
      if (!panning) return; wrap.scrollLeft = ssl - (e.clientX - sx); wrap.scrollTop = sst - (e.clientY - sy);
    });
    document.addEventListener('mouseup', function() { if (panning) { panning = false; wrap.classList.remove('panning'); } });
    wrap.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER
  // ═══════════════════════════════════════════════════════════════
  function toggleExternalWindow() {
    if (_externalWindow && !_externalWindow.closed) {
      _externalWindow.close(); _externalWindow = null; updateDetachButton();
      var panel = document.getElementById('previewPanel'); var handle = document.getElementById('previewResizeHandle');
      if (panel) panel.classList.add('open'); if (handle) handle.style.display = '';
      if (_currentFile) openInViewer(_currentFile);
      return;
    }
    openExternalWindow();
    var panel = document.getElementById('previewPanel'); var handle = document.getElementById('previewResizeHandle');
    if (panel) panel.classList.remove('open'); if (handle) handle.style.display = 'none';
  }

  function openExternalWindow() {
    var extWin = window.open('', 'sl-viewer-ext', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) { alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.'); return; }
    _externalWindow = extWin;

    extWin.document.open();
    extWin.document.write(buildExtHTML());
    extWin.document.close();

    var initFn = function() {
      if (extWin.__initialized) return;
      setupExtHandlers(extWin);
      if (_currentFile) loadFileInExternal(_currentFile); else showExtPlaceholder();
    };
    extWin.addEventListener('load', initFn);
    setTimeout(initFn, 300);

    var checkClosed = setInterval(function() {
      if (!_externalWindow || _externalWindow.closed) {
        clearInterval(checkClosed); _externalWindow = null; updateDetachButton();
        var p = document.getElementById('previewPanel'); var h = document.getElementById('previewResizeHandle');
        if (p && _currentFile) { p.classList.add('open'); if (h) h.style.display = ''; openInViewer(_currentFile); }
      }
    }, 500);
    updateDetachButton();
  }

  function updateDetachButton() {
    var btn = document.getElementById('sl-detach-external'); var label = document.getElementById('sl-detach-label');
    if (!btn || !label) return;
    if (_externalWindow && !_externalWindow.closed) { btn.classList.add('active'); label.textContent = 'Wieder andocken'; }
    else { btn.classList.remove('active'); label.textContent = 'Abkoppeln'; }
  }

  function buildExtHTML() {
    return '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}' +
      '.toolbar{display:flex;align-items:center;gap:6px;padding:8px 12px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0}' +
      '.title{flex:1;font-size:13px;font-weight:600;color:#e4e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px}' +
      'button{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:4px 10px;font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;transition:all .15s}' +
      'button:hover:not(:disabled){border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      'button svg{width:14px;height:14px;fill:currentColor}' +
      '.info{font-family:"DM Mono",monospace;font-size:12px;color:#7a8199;padding:0 6px;min-width:50px;text-align:center;cursor:pointer;user-select:none}' +
      '.info:hover{color:#00c2ff}' +
      '.spacer{flex:1}' +
      '.wrap{flex:1;overflow:auto;background:#2a2d3e;position:relative}' +
      '.wrap.panning{cursor:grabbing;user-select:none}' +
      '.wrap::-webkit-scrollbar{width:10px;height:10px}' +
      '.wrap::-webkit-scrollbar-thumb{background:#555;border-radius:5px}' +
      '.page-container{display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px;min-width:min-content;min-height:min-content}' +
      '.page{background:white;box-shadow:0 2px 12px rgba(0,0,0,.5);display:block}' +
      '.image{display:block;box-shadow:0 2px 12px rgba(0,0,0,.5);image-rendering:-webkit-optimize-contrast}' +
      '.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#7a8199;gap:12px;padding:40px}' +
      '.spinner{width:40px;height:40px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:spin .7s linear infinite}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '.placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#7a8199;gap:16px;padding:40px;text-align:center}' +
      '.placeholder svg{width:64px;height:64px;opacity:.3;fill:currentColor}' +
      '.error{color:#ef4444;padding:20px;text-align:center}' +
      '.hint{padding:4px 12px;background:#0f1117;color:#7a8199;font-size:10px;text-align:center;border-top:1px solid #2a2d3e;flex-shrink:0}' +
      '</style></head><body>' +
      '<div class="toolbar">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title" id="extTitle">Warte auf Auswahl…</div>' +
        '<button id="extPrevPage" style="display:none"><svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
        '<span class="info" id="extPageInfo" style="display:none">–</span>' +
        '<button id="extNextPage" style="display:none"><svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>' +
        '<button id="extZoomOut">−</button>' +
        '<span class="info" id="extZoomInfo" title="Klicken = Fit">100%</span>' +
        '<button id="extZoomIn">+</button>' +
        '<button id="extZoomFit">Fit</button>' +
        '<button id="extZoom100">100%</button>' +
        '<div class="spacer"></div>' +
        '<button id="extFullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg> Vollbild</button>' +
      '</div>' +
      '<div class="wrap" id="extWrap"><div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div></div>' +
      '<div class="hint">Strg+Mausrad = Zoom · Mittlere Maustaste halten = Verschieben · F11 = Vollbild</div>' +
      '</body></html>';
  }

  function showExtPlaceholder() {
    if (!_externalWindow || _externalWindow.closed) return;
    var doc = _externalWindow.document;
    var wrap = doc.getElementById('extWrap');
    var title = doc.getElementById('extTitle');
    if (wrap) wrap.innerHTML = '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>';
    if (title) title.textContent = 'Warte auf Auswahl…';
  }

  function setupExtHandlers(extWin) {
    if (extWin.__initialized) return;
    extWin.__initialized = true;

    var doc = extWin.document;
    var st = { pdf: null, page: 1, zoom: 1.0, fitZoom: 1.0, blobUrl: null, pageViewports: {} };
    extWin.__state = st;

    var zd = null;

    function updateExtCanvasSizes() {
      if (!st.pdf) return;
      for (var i = 1; i <= st.pdf.numPages; i++) {
        var c = doc.getElementById('extPage' + i); var vp = st.pageViewports[i];
        if (c && vp) { c.style.width = (vp.width * st.zoom) + 'px'; c.style.height = (vp.height * st.zoom) + 'px'; }
      }
    }

    function rerenderExt() {
      if (!st.pdf) return;
      var promises = [];
      var dpr = extWin.devicePixelRatio || 1;
      for (var i = 1; i <= st.pdf.numPages; i++) {
        var c = doc.getElementById('extPage' + i);
        if (c) promises.push(renderPage(st.pdf, i, c, st.zoom, dpr));
      }
      return Promise.all(promises);
    }

    function updatePI() { var e = doc.getElementById('extPageInfo'); if (e && st.pdf) e.textContent = st.page + ' / ' + st.pdf.numPages; }
    function updateZI() { var e = doc.getElementById('extZoomInfo'); if (e) e.textContent = Math.round(st.zoom * 100) + '%'; }

    function setExtZoom(z) {
      st.zoom = Math.max(0.1, Math.min(6, z));
      updateZI();
      if (st.pdf) { updateExtCanvasSizes(); if (zd) clearTimeout(zd); zd = setTimeout(rerenderExt, 250); }
      else { var img = doc.querySelector('.image'); if (img) { img.style.width = (img.naturalWidth * st.zoom) + 'px'; img.style.height = (img.naturalHeight * st.zoom) + 'px'; } }
    }

    var b;
    b = doc.getElementById('extZoomIn'); if (b) b.onclick = function() { setExtZoom(st.zoom * 1.15); };
    b = doc.getElementById('extZoomOut'); if (b) b.onclick = function() { setExtZoom(st.zoom / 1.15); };
    b = doc.getElementById('extZoomFit'); if (b) b.onclick = function() { setExtZoom(st.fitZoom); };
    b = doc.getElementById('extZoom100'); if (b) b.onclick = function() { setExtZoom(1.0); };
    b = doc.getElementById('extZoomInfo'); if (b) b.onclick = function() { setExtZoom(st.fitZoom); };
    b = doc.getElementById('extPrevPage'); if (b) b.onclick = function() {
      if (st.page > 1) { st.page--; var t = doc.getElementById('extPage' + st.page); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); updatePI(); }
    };
    b = doc.getElementById('extNextPage'); if (b) b.onclick = function() {
      if (st.pdf && st.page < st.pdf.numPages) { st.page++; var t = doc.getElementById('extPage' + st.page); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); updatePI(); }
    };
    b = doc.getElementById('extFullscreen'); if (b) b.onclick = function() { if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen(); };

    var wrap = doc.getElementById('extWrap');
    wrap.addEventListener('wheel', function(e) { if (!e.ctrlKey) return; e.preventDefault(); setExtZoom(st.zoom * (e.deltaY > 0 ? 1 / 1.1 : 1.1)); }, { passive: false });

    var pan = false, px = 0, py = 0, psl = 0, pst = 0;
    wrap.addEventListener('mousedown', function(e) { if (e.button !== 1) return; e.preventDefault(); pan = true; px = e.clientX; py = e.clientY; psl = wrap.scrollLeft; pst = wrap.scrollTop; wrap.classList.add('panning'); });
    doc.addEventListener('mousemove', function(e) { if (!pan) return; wrap.scrollLeft = psl - (e.clientX - px); wrap.scrollTop = pst - (e.clientY - py); });
    doc.addEventListener('mouseup', function() { if (pan) { pan = false; wrap.classList.remove('panning'); } });
    wrap.addEventListener('auxclick', function(e) { if (e.button === 1) e.preventDefault(); });

    // Expose render für loadFileInExternal
    extWin.__renderAll = function() {
      if (!st.pdf) return Promise.resolve();
      var wrap = doc.getElementById('extWrap');
      wrap.innerHTML = '<div class="page-container" id="extPageContainer"></div>';
      var container = doc.getElementById('extPageContainer');
      var dpr = extWin.devicePixelRatio || 1;

      return st.pdf.getPage(1).then(function(fp) {
        var fvp = fp.getViewport({ scale: 1.0 });
        var aw = wrap.clientWidth - 40;
        var ah = wrap.clientHeight - 40;
        st.fitZoom = Math.min(aw / fvp.width, ah / fvp.height);
        st.zoom = st.fitZoom;
        st.page = 1;
        st.pageViewports = {};

        var promises = [];
        for (var i = 1; i <= st.pdf.numPages; i++) {
          (function(n) {
            var c = doc.createElement('canvas');
            c.className = 'page';
            c.id = 'extPage' + n;
            container.appendChild(c);
            promises.push(renderPage(st.pdf, n, c, st.zoom, dpr).then(function(bvp) {
              st.pageViewports[n] = bvp;
            }));
          })(i);
        }
        updatePI();
        updateZI();
        return Promise.all(promises);
      });
    };
  }

  function loadFileInExternal(file) {
    if (!_externalWindow || _externalWindow.closed) return;
    if (!_externalWindow.__initialized) { setupExtHandlers(_externalWindow); }

    var doc = _externalWindow.document;
    var wrap = doc.getElementById('extWrap');
    var title = doc.getElementById('extTitle');
    var st = _externalWindow.__state;
    if (!wrap || !st) { setTimeout(function() { loadFileInExternal(file); }, 200); return; }

    if (title) title.textContent = file.name || 'Datei';
    wrap.innerHTML = '<div class="loading"><div class="spinner"></div><div>Lade…</div></div>';

    var kind = getFileKind(file.name);
    st.pdf = null; st.page = 1; st.pageViewports = {};

    var pp = doc.getElementById('extPrevPage'); var np = doc.getElementById('extNextPage'); var pi = doc.getElementById('extPageInfo');
    if (pp) pp.style.display = kind === 'pdf' ? '' : 'none';
    if (np) np.style.display = kind === 'pdf' ? '' : 'none';
    if (pi) pi.style.display = kind === 'pdf' ? '' : 'none';

    var fileId = getFileId(file);
    if (!fileId || (kind !== 'pdf' && kind !== 'image')) {
      wrap.innerHTML = '<div class="placeholder"><div>Dieser Dateityp wird nicht unterstützt.</div></div>';
      return;
    }

    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.arrayBuffer();
    }).then(function(buf) {
      if (kind === 'image') {
        var blob = new Blob([buf]);
        if (st.blobUrl) try { URL.revokeObjectURL(st.blobUrl); } catch(e){}
        st.blobUrl = URL.createObjectURL(blob);
        wrap.innerHTML = '<div class="page-container"></div>';
        var container = wrap.querySelector('.page-container');
        var img = doc.createElement('img');
        img.className = 'image';
        img.src = st.blobUrl;
        container.appendChild(img);
        img.onload = function() {
          var aw = wrap.clientWidth - 40; var ah = wrap.clientHeight - 40;
          st.fitZoom = Math.min(1, Math.min(aw / (img.naturalWidth || 1), ah / (img.naturalHeight || 1)));
          st.zoom = st.fitZoom;
          img.style.width = (img.naturalWidth * st.zoom) + 'px';
          img.style.height = (img.naturalHeight * st.zoom) + 'px';
          var zi = doc.getElementById('extZoomInfo'); if (zi) zi.textContent = Math.round(st.zoom * 100) + '%';
        };
        return;
      }

      // ═══ PDF laden MIT cMaps + StandardFonts ═══
      return loadPdfJs().then(function() {
        return loadPdfDocument(buf);
      }).then(function(pdf) {
        st.pdf = pdf;
        return _externalWindow.__renderAll();
      });
    }).catch(function(e) {
      console.error('[ExtViewer] Fehler:', e);
      wrap.innerHTML = '<div class="error">Fehler beim Laden:<br>' + (e.message || e) + '</div>';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  TOOLBAR EVENTS (INLINE)
  // ═══════════════════════════════════════════════════════════════
  function bindToolbarEvents() {
    var b;
    b = document.getElementById('sl-prev-page'); if (b) b.onclick = prevPage;
    b = document.getElementById('sl-next-page'); if (b) b.onclick = nextPage;
    b = document.getElementById('sl-zoom-in'); if (b) b.onclick = zoomIn;
    b = document.getElementById('sl-zoom-out'); if (b) b.onclick = zoomOut;
    b = document.getElementById('sl-zoom-fit'); if (b) b.onclick = zoomFit;
    b = document.getElementById('sl-zoom-100'); if (b) b.onclick = zoom100;
    b = document.getElementById('sl-zoom-info'); if (b) b.onclick = zoomFit;
    b = document.getElementById('sl-detach-external'); if (b) b.onclick = toggleExternalWindow;
    b = document.getElementById('sl-download'); if (b) b.onclick = function() {
      if (_currentFile) { var idx = allFiles.indexOf(_currentFile); if (idx >= 0 && typeof downloadFile === 'function') downloadFile(idx); }
    };
    var wrap = document.getElementById('sl-canvas-wrap');
    if (wrap) { setupWheelZoom(wrap); setupMiddleMousePan(wrap); }
  }

  function cleanupCurrentBlob() {
    if (_currentBlobUrl) { try { URL.revokeObjectURL(_currentBlobUrl); } catch(e){} _currentBlobUrl = null; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  OPEN IN VIEWER
  // ═══════════════════════════════════════════════════════════════
  function openInViewer(file) {
    if (!file) return false;
    injectStyles();
    var kind = getFileKind(file.name);
    if (kind !== 'pdf' && kind !== 'image') return false;

    _currentFile = file;

    if (_externalWindow && !_externalWindow.closed) { loadFileInExternal(file); return true; }

    cleanupCurrentBlob();
    _currentPdf = null; _currentPage = 1; _currentZoom = 1.0; _pageOriginalViewports = {};

    var panel = document.getElementById('previewPanel'); var handle = document.getElementById('previewResizeHandle');
    var bodyEl = document.getElementById('previewBody'); var titleEl = document.getElementById('previewTitle');
    var metaEl = document.getElementById('previewMeta'); var zoomToolbar = document.getElementById('zoomToolbar');

    if (!panel || !bodyEl) return false;
    panel.classList.add('open'); if (handle) handle.style.display = '';
    if (titleEl) titleEl.textContent = file.name || 'Vorschau';
    if (metaEl) metaEl.style.display = 'none';
    if (zoomToolbar) zoomToolbar.style.display = 'none';

    var container = document.createElement('div');
    container.className = 'sl-viewer-container';
    container.innerHTML = buildViewerHTML(kind);
    bodyEl.innerHTML = '';
    bodyEl.appendChild(container);
    bindToolbarEvents();

    var pageContainer = document.getElementById('sl-page-container');
    var fileId = getFileId(file);
    if (!fileId) { pageContainer.innerHTML = '<div class="sl-viewer-error">Keine Datei-ID</div>'; return true; }

    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.arrayBuffer();
    }).then(function(buf) {
      _currentPdfBuffer = buf;

      if (kind === 'image') {
        var blob = new Blob([buf]);
        _currentBlobUrl = URL.createObjectURL(blob);
        pageContainer.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'sl-viewer-image';
        img.src = _currentBlobUrl;
        pageContainer.appendChild(img);
        img.onload = function() {
          var wrap = document.getElementById('sl-canvas-wrap');
          var aw = wrap ? wrap.clientWidth - 40 : 800; var ah = wrap ? wrap.clientHeight - 40 : 600;
          _fitZoom = Math.min(1, Math.min(aw / (img.naturalWidth || 1), ah / (img.naturalHeight || 1)));
          _currentZoom = _fitZoom;
          img.style.width = (img.naturalWidth * _currentZoom) + 'px';
          img.style.height = (img.naturalHeight * _currentZoom) + 'px';
          updateZoomInfo();
        };
        var pgi = document.getElementById('sl-page-info'); var pp = document.getElementById('sl-prev-page'); var np = document.getElementById('sl-next-page');
        if (pgi) pgi.style.display = 'none'; if (pp) pp.style.display = 'none'; if (np) np.style.display = 'none';
        return;
      }

      // ═══ PDF laden MIT cMaps + StandardFonts ═══
      return loadPdfJs().then(function() {
        return loadPdfDocument(buf);
      }).then(function(pdf) {
        _currentPdf = pdf;
        var wrap = document.getElementById('sl-canvas-wrap');
        return renderAllPages(pdf, pageContainer, null, wrap).then(function(result) {
          _fitZoom = result.fitZoom;
          _currentZoom = result.zoom;
          _pageOriginalViewports = result.pageViewports;
          updateZoomInfo();
        });
      });
    }).catch(function(e) {
      console.error('[Viewer] Fehler:', e);
      pageContainer.innerHTML = '<div class="sl-viewer-error">Fehler beim Laden:<br>' + (e.message || e) + '</div>';
    });

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOKS
  // ═══════════════════════════════════════════════════════════════
  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;
    if (_externalWindow && !_externalWindow.closed) {
      var kind = getFileKind(file.name);
      if (kind === 'pdf' || kind === 'image') { _currentFile = file; loadFileInExternal(file); return; }
    }
    var handled = openInViewer(file);
    if (!handled && typeof _origOpenPreview === 'function') _origOpenPreview(idx);
  };

  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    cleanupCurrentBlob(); _currentFile = null; _currentPdf = null;
    if (_externalWindow && !_externalWindow.closed) showExtPlaceholder();
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v5 geladen (cMap + StandardFonts Fix)');
})();
