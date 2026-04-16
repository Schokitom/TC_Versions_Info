// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v1
//  PDF + Bild Viewer mit Abkoppeln (draggable Floating-Fenster)
// ═══════════════════════════════════════════════════════════════
//
//  Features:
//  - PDFs mit PDF.js rendern (schnell, alle Seiten, Zoom, Navigation)
//  - Bilder (PNG/JPG/WEBP/GIF) nativ rendern
//  - Abkoppel-Button: Vorschau wird zu einem draggable Floating-Fenster
//  - Resize-Handles am Floating-Fenster
//  - Fallback zum Trimble-Viewer für andere Dateitypen (DWG, XLS, etc.)
//
//  Integration: <script src="viewer-v1.js"></script>
//  (NACH dem Haupt-Script der index.html einfügen)
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

  // ─── PDF.js Lazy Loader ───
  function loadPdfJs() {
    if (_pdfjsLib) return Promise.resolve(_pdfjsLib);
    return import(PDFJS_URL).then(function(lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      _pdfjsLib = lib;
      return lib;
    });
  }

  // ─── Download-URL holen ───
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

  // ─── Datei-Typ erkennen ───
  function getFileKind(name) {
    var lower = (name || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lower)) return 'image';
    return 'other';
  }

  // ─── CSS für Floating-Fenster und Viewer-Tools ───
  function injectStyles() {
    if (document.getElementById('sl-viewer-styles')) return;
    var css = '\n' +
      '/* Viewer Container */\n' +
      '.sl-viewer-container { position: relative; width: 100%; height: 100%; background: #1a1d27; display: flex; flex-direction: column; overflow: hidden; }\n' +
      '.sl-viewer-toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: #0f1117; border-bottom: 1px solid #2a2d3e; flex-shrink: 0; flex-wrap: wrap; }\n' +
      '.sl-viewer-btn { background: none; border: 1px solid #2a2d3e; border-radius: 4px; color: #7a8199; cursor: pointer; padding: 3px 8px; font-size: 11px; font-family: var(--font-ui, sans-serif); display: inline-flex; align-items: center; gap: 3px; transition: all .15s; white-space: nowrap; }\n' +
      '.sl-viewer-btn:hover:not(:disabled) { border-color: #00c2ff; color: #00c2ff; background: #1e2235; }\n' +
      '.sl-viewer-btn:disabled { opacity: .4; cursor: not-allowed; }\n' +
      '.sl-viewer-btn svg { width: 12px; height: 12px; fill: currentColor; }\n' +
      '.sl-viewer-page-info { font-family: var(--font, monospace); font-size: 11px; color: #7a8199; padding: 0 4px; min-width: 60px; text-align: center; }\n' +
      '.sl-viewer-zoom-info { font-family: var(--font, monospace); font-size: 11px; color: #7a8199; min-width: 40px; text-align: center; }\n' +
      '.sl-viewer-spacer { flex: 1; }\n' +
      '.sl-viewer-canvas-wrap { flex: 1; overflow: auto; background: #2a2d3e; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; }\n' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar { width: 8px; height: 8px; }\n' +
      '.sl-viewer-canvas-wrap::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }\n' +
      '.sl-viewer-page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.4); max-width: 100%; }\n' +
      '.sl-viewer-image { max-width: 100%; max-height: 100%; box-shadow: 0 2px 8px rgba(0,0,0,.4); }\n' +
      '.sl-viewer-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #7a8199; gap: 12px; }\n' +
      '.sl-viewer-spinner { width: 36px; height: 36px; border: 3px solid #2a2d3e; border-top-color: #00c2ff; border-radius: 50%; animation: sl-spin .7s linear infinite; }\n' +
      '@keyframes sl-spin { to { transform: rotate(360deg); } }\n' +
      '.sl-viewer-error { color: #ef4444; padding: 20px; text-align: center; font-size: 12px; }\n' +
      '\n' +
      '/* Floating-Fenster */\n' +
      '.sl-floating-viewer { position: fixed; top: 80px; left: 80px; width: 800px; height: 600px; background: #1a1d27; border: 1px solid #00c2ff; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.6); z-index: 9999; display: flex; flex-direction: column; overflow: hidden; min-width: 400px; min-height: 300px; resize: both; }\n' +
      '.sl-floating-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #0f1117; border-bottom: 1px solid #2a2d3e; cursor: move; user-select: none; flex-shrink: 0; }\n' +
      '.sl-floating-header .title { flex: 1; font-size: 12px; font-weight: 600; color: #e4e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
      '.sl-floating-close { background: none; border: none; color: #7a8199; cursor: pointer; font-size: 16px; padding: 0 4px; }\n' +
      '.sl-floating-close:hover { color: #ef4444; }\n' +
      '.sl-floating-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }\n';
    var style = document.createElement('style');
    style.id = 'sl-viewer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── Viewer-UI HTML erzeugen ───
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
        '<button class="sl-viewer-btn" id="sl-detach" title="Abkoppeln / Andocken">' +
          '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3m-2 16H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z"/></svg>' +
          '<span id="sl-detach-label">Abkoppeln</span>' +
        '</button>' +
        '<button class="sl-viewer-btn" id="sl-download" title="Download">' +
          '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="sl-viewer-canvas-wrap" id="sl-canvas-wrap">' +
        '<div class="sl-viewer-loading"><div class="sl-viewer-spinner"></div><div>Lade…</div></div>' +
      '</div>';
  }

  // ─── PDF rendern ───
  function renderPdf(pdf, targetWrap) {
    targetWrap.innerHTML = '';
    _currentPage = 1;

    // Alle Seiten gleichzeitig vorab anzeigen (Platzhalter) für schnelles Scrollen
    var renderPromises = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      (function(pageNum) {
        var canvas = document.createElement('canvas');
        canvas.className = 'sl-viewer-page';
        canvas.id = 'sl-page-' + pageNum;
        targetWrap.appendChild(canvas);

        renderPromises.push(
          pdf.getPage(pageNum).then(function(page) {
            var viewport = page.getViewport({ scale: _currentZoom * 1.5 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = (viewport.width / 1.5) + 'px';
            canvas.style.height = (viewport.height / 1.5) + 'px';
            return page.render({
              canvasContext: canvas.getContext('2d'),
              viewport: viewport,
            }).promise;
          })
        );
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
    renderPdf(_currentPdf, wrap);
  }

  function updatePageInfo() {
    var el = document.getElementById('sl-page-info');
    if (el && _currentPdf) el.textContent = _currentPage + ' / ' + _currentPdf.numPages;
  }

  function updateZoomInfo() {
    var el = document.getElementById('sl-zoom-info');
    if (el) el.textContent = Math.round(_currentZoom * 100) + '%';
  }

  // ─── Navigation ───
  function scrollToPage(pageNum) {
    var target = document.getElementById('sl-page-' + pageNum);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      _currentPage = pageNum;
      updatePageInfo();
    }
  }

  function prevPage() {
    if (_currentPage > 1) scrollToPage(_currentPage - 1);
  }

  function nextPage() {
    if (_currentPdf && _currentPage < _currentPdf.numPages) scrollToPage(_currentPage + 1);
  }

  function zoomIn() {
    _currentZoom = Math.min(_currentZoom + 0.15, 3);
    updateZoomInfo();
    if (_currentPdf) rerenderCurrentPdf();
    else if (_currentFile && getFileKind(_currentFile.name) === 'image') {
      var img = document.querySelector('.sl-viewer-image');
      if (img) img.style.transform = 'scale(' + _currentZoom + ')';
    }
  }

  function zoomOut() {
    _currentZoom = Math.max(_currentZoom - 0.15, 0.3);
    updateZoomInfo();
    if (_currentPdf) rerenderCurrentPdf();
    else if (_currentFile && getFileKind(_currentFile.name) === 'image') {
      var img = document.querySelector('.sl-viewer-image');
      if (img) img.style.transform = 'scale(' + _currentZoom + ')';
    }
  }

  function zoomFit() {
    _currentZoom = 1.0;
    updateZoomInfo();
    if (_currentPdf) rerenderCurrentPdf();
    else if (_currentFile && getFileKind(_currentFile.name) === 'image') {
      var img = document.querySelector('.sl-viewer-image');
      if (img) img.style.transform = 'scale(1)';
    }
  }

  // ─── Detach / Attach ───
  function detach() {
    if (_isDetached) return attach();
    _isDetached = true;

    var panel = document.getElementById('previewPanel');
    var bodyEl = document.getElementById('previewBody');
    if (!panel || !bodyEl) return;

    // Floating-Container erzeugen
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

    // Viewer-Inhalt ins Floating verschieben
    var viewerContainer = bodyEl.querySelector('.sl-viewer-container');
    if (viewerContainer) {
      document.getElementById('sl-floating-body').appendChild(viewerContainer);
    }

    // Label im Toolbar-Button anpassen
    var label = document.getElementById('sl-detach-label');
    if (label) label.textContent = 'Andocken';

    // Preview-Panel schließen
    panel.classList.remove('open');
    var handle = document.getElementById('previewResizeHandle');
    if (handle) handle.style.display = 'none';

    // Drag-Funktion
    setupDrag(floating);

    // Close-Button
    document.getElementById('sl-floating-close').onclick = function() {
      closeFloating();
    };
  }

  function attach() {
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

  // ─── Drag-Funktion für Floating-Fenster ───
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

  // ─── Event-Handler binden ───
  function bindToolbarEvents() {
    var btn;
    btn = document.getElementById('sl-prev-page'); if (btn) btn.onclick = prevPage;
    btn = document.getElementById('sl-next-page'); if (btn) btn.onclick = nextPage;
    btn = document.getElementById('sl-zoom-in'); if (btn) btn.onclick = zoomIn;
    btn = document.getElementById('sl-zoom-out'); if (btn) btn.onclick = zoomOut;
    btn = document.getElementById('sl-zoom-fit'); if (btn) btn.onclick = zoomFit;
    btn = document.getElementById('sl-detach'); if (btn) btn.onclick = detach;
    btn = document.getElementById('sl-download'); if (btn) btn.onclick = function() {
      if (_currentFile) {
        var idx = allFiles.indexOf(_currentFile);
        if (idx >= 0 && typeof downloadFile === 'function') downloadFile(idx);
      }
    };
  }

  // ─── Blob-URL cleanup ───
  function cleanupCurrentBlob() {
    if (_currentBlobUrl) {
      try { URL.revokeObjectURL(_currentBlobUrl); } catch(e) {}
      _currentBlobUrl = null;
    }
  }

  // ─── Hauptfunktion: Datei öffnen ───
  function openInViewer(file) {
    if (!file) return false;

    injectStyles();

    var kind = getFileKind(file.name);

    // Nur PDF und Bilder werden intern behandelt
    if (kind !== 'pdf' && kind !== 'image') {
      return false; // Fallback zum Trimble-Viewer
    }

    cleanupCurrentBlob();
    _currentFile = file;
    _currentPdf = null;
    _currentPage = 1;
    _currentZoom = 1.0;

    // Preview-Panel öffnen
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
    if (metaEl) metaEl.style.display = 'none'; // verstecke die alte Meta-Zeile
    if (zoomToolbar) zoomToolbar.style.display = 'none'; // verstecke alte Zoom-Toolbar

    // Viewer-HTML aufbauen
    var container = document.createElement('div');
    container.className = 'sl-viewer-container';
    container.innerHTML = buildViewerHTML(kind);

    // In Ziel einsetzen (entweder eingebettet oder floating)
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

    // Download-URL holen, dann laden
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
        // Page-Info für Bilder verstecken
        var pgi = document.getElementById('sl-page-info');
        if (pgi) pgi.style.display = 'none';
        var pp = document.getElementById('sl-prev-page');
        var np = document.getElementById('sl-next-page');
        if (pp) pp.style.display = 'none';
        if (np) np.style.display = 'none';
        return;
      }

      // PDF
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

  // ─── openPreview überschreiben ───
  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;
    var handled = openInViewer(file);
    if (!handled && typeof _origOpenPreview === 'function') {
      // Fallback: Original-Viewer (Trimble iframe)
      _origOpenPreview(idx);
    }
  };

  // ─── closePreview erweitern ───
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

  console.log('[Viewer] Enhanced Viewer v1 geladen (PDF + Image + Detach)');
})();
