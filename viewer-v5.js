// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v6
//  Nativer Browser-PDF-Viewer (embed) + Abkoppeln
// ═══════════════════════════════════════════════════════════════
//
//  Nutzt den eingebauten PDF-Viewer des Browsers:
//  - Gestochen scharfe Darstellung (nativ gerendert)
//  - Eigener Zoom, Seitennavigation, Suche (Strg+F)
//  - Drucken (Strg+P) direkt aus dem Viewer
//  - Externes Fenster mit Continuous Preview
//
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var _currentFile = null;
  var _currentBlobUrl = null;
  var _externalWindow = null;

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

  function cleanupBlob() {
    if (_currentBlobUrl) {
      try { URL.revokeObjectURL(_currentBlobUrl); } catch(e) {}
      _currentBlobUrl = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CSS
  // ═══════════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById('sl-viewer-styles')) return;
    var css =
      '.sl-viewer-container{position:relative;width:100%;height:100%;background:#1a1d27;display:flex;flex-direction:column;overflow:hidden}' +
      '.sl-viewer-toolbar{display:flex;align-items:center;gap:4px;padding:6px 10px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0}' +
      '.sl-viewer-btn{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:3px 8px;font-size:11px;font-family:var(--font-ui,sans-serif);display:inline-flex;align-items:center;gap:3px;transition:all .15s;white-space:nowrap}' +
      '.sl-viewer-btn:hover:not(:disabled){border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      '.sl-viewer-btn svg{width:12px;height:12px;fill:currentColor}' +
      '.sl-viewer-btn.active{background:#005f8a;color:#fff;border-color:#00c2ff}' +
      '.sl-viewer-title{font-family:var(--font,monospace);font-size:11px;color:#e4e8f0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}' +
      '.sl-viewer-spacer{flex:1}' +
      '.sl-viewer-body{flex:1;overflow:hidden;background:#2a2d3e;position:relative}' +
      '.sl-viewer-body embed,.sl-viewer-body object,.sl-viewer-body iframe{width:100%;height:100%;border:none;display:block}' +
      '.sl-viewer-body img{max-width:100%;max-height:100%;display:block;margin:auto;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 2px 12px rgba(0,0,0,.5)}' +
      '.sl-viewer-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:12px}' +
      '.sl-viewer-spinner{width:36px;height:36px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:sl-spin .7s linear infinite}' +
      '@keyframes sl-spin{to{transform:rotate(360deg)}}' +
      '.sl-viewer-error{color:#ef4444;padding:20px;text-align:center;font-size:12px;width:100%;height:100%;display:flex;align-items:center;justify-content:center}';
    var style = document.createElement('style');
    style.id = 'sl-viewer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════
  //  INLINE VIEWER
  // ═══════════════════════════════════════════════════════════════
  function buildInlineHTML() {
    var extLabel = _externalWindow && !_externalWindow.closed ? 'Wieder andocken' : 'Abkoppeln';
    var extClass = _externalWindow && !_externalWindow.closed ? 'sl-viewer-btn active' : 'sl-viewer-btn';

    return '<div class="sl-viewer-toolbar">' +
      '<span class="sl-viewer-title" id="sl-title"></span>' +
      '<div class="sl-viewer-spacer"></div>' +
      '<button class="' + extClass + '" id="sl-detach-external">' +
        '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg>' +
        '<span id="sl-detach-label">' + extLabel + '</span>' +
      '</button>' +
      '<button class="sl-viewer-btn" id="sl-download">' +
        '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg>' +
      '</button>' +
      '</div>' +
      '<div class="sl-viewer-body" id="sl-body">' +
        '<div class="sl-viewer-loading"><div class="sl-viewer-spinner"></div><div>Lade…</div></div>' +
      '</div>';
  }

  function loadIntoInline(file) {
    injectStyles();
    var kind = getFileKind(file.name);
    if (kind !== 'pdf' && kind !== 'image') return false;

    _currentFile = file;
    cleanupBlob();

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
    container.innerHTML = buildInlineHTML();
    bodyEl.innerHTML = '';
    bodyEl.appendChild(container);

    var slTitle = document.getElementById('sl-title');
    if (slTitle) slTitle.textContent = file.name;

    // Toolbar-Events
    var detachBtn = document.getElementById('sl-detach-external');
    if (detachBtn) detachBtn.onclick = toggleExternalWindow;

    var dlBtn = document.getElementById('sl-download');
    if (dlBtn) dlBtn.onclick = function() {
      if (_currentFile) {
        var idx = allFiles.indexOf(_currentFile);
        if (idx >= 0 && typeof downloadFile === 'function') downloadFile(idx);
      }
    };

    var slBody = document.getElementById('sl-body');
    var fileId = getFileId(file);
    if (!fileId) {
      slBody.innerHTML = '<div class="sl-viewer-error">Keine Datei-ID</div>';
      return true;
    }

    // Download und rendern
    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.blob();
    }).then(function(blob) {
      // Blob-URL erzeugen
      var blobType = kind === 'pdf' ? 'application/pdf' : blob.type;
      var typedBlob = new Blob([blob], { type: blobType });
      _currentBlobUrl = URL.createObjectURL(typedBlob);

      slBody.innerHTML = '';

      if (kind === 'pdf') {
        // Nativer PDF-Viewer via embed
        var embed = document.createElement('embed');
        embed.type = 'application/pdf';
        embed.src = _currentBlobUrl;
        slBody.appendChild(embed);
      } else {
        // Bild
        var img = document.createElement('img');
        img.src = _currentBlobUrl;
        slBody.appendChild(img);
      }
    }).catch(function(e) {
      console.error('[Viewer] Fehler:', e);
      slBody.innerHTML = '<div class="sl-viewer-error">Fehler: ' + escHtml(e.message) + '</div>';
    });

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER
  // ═══════════════════════════════════════════════════════════════
  function toggleExternalWindow() {
    if (_externalWindow && !_externalWindow.closed) {
      _externalWindow.close();
      _externalWindow = null;
      updateDetachButton();
      var panel = document.getElementById('previewPanel');
      var handle = document.getElementById('previewResizeHandle');
      if (panel) panel.classList.add('open');
      if (handle) handle.style.display = '';
      if (_currentFile) loadIntoInline(_currentFile);
      return;
    }

    // Neues Fenster öffnen
    openExternalWindow();

    // Inline-Panel ausblenden
    var panel = document.getElementById('previewPanel');
    var handle = document.getElementById('previewResizeHandle');
    if (panel) panel.classList.remove('open');
    if (handle) handle.style.display = 'none';
  }

  function openExternalWindow() {
    var extWin = window.open('', 'sl-viewer-ext', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) {
      alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
      return;
    }

    _externalWindow = extWin;

    extWin.document.open();
    extWin.document.write(buildExtHTML());
    extWin.document.close();

    var initFn = function() {
      if (extWin.__initialized) return;
      extWin.__initialized = true;

      // Fullscreen-Button
      var fsBtn = extWin.document.getElementById('extFullscreen');
      if (fsBtn) fsBtn.onclick = function() {
        if (extWin.document.documentElement.requestFullscreen) extWin.document.documentElement.requestFullscreen();
      };

      // Erstes File laden
      if (_currentFile) loadFileInExternal(_currentFile);
      else showExtPlaceholder();
    };

    extWin.addEventListener('load', initFn);
    setTimeout(initFn, 300);

    // Erkennen wenn Fenster geschlossen wird
    var checkClosed = setInterval(function() {
      if (!_externalWindow || _externalWindow.closed) {
        clearInterval(checkClosed);
        _externalWindow = null;
        updateDetachButton();
        var p = document.getElementById('previewPanel');
        var h = document.getElementById('previewResizeHandle');
        if (p && _currentFile) {
          p.classList.add('open');
          if (h) h.style.display = '';
          loadIntoInline(_currentFile);
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

  function buildExtHTML() {
    return '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}' +
      '.toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0}' +
      '.title{flex:1;font-size:13px;font-weight:600;color:#e4e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px}' +
      'button{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:4px 10px;font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;transition:all .15s}' +
      'button:hover{border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      'button svg{width:14px;height:14px;fill:currentColor}' +
      '.body{flex:1;overflow:hidden;background:#2a2d3e;position:relative}' +
      '.body embed,.body object,.body iframe{width:100%;height:100%;border:none;display:block}' +
      '.body img{max-width:100%;max-height:100%;display:block;margin:auto;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 2px 12px rgba(0,0,0,.5)}' +
      '.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:12px}' +
      '.spinner{width:40px;height:40px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:spin .7s linear infinite}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '.placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:16px;padding:40px;text-align:center}' +
      '.placeholder svg{width:64px;height:64px;opacity:.3;fill:currentColor}' +
      '.error{color:#ef4444;padding:20px;text-align:center;width:100%;height:100%;display:flex;align-items:center;justify-content:center}' +
      '</style></head><body>' +
      '<div class="toolbar">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title" id="extTitle">Warte auf Auswahl…</div>' +
        '<button id="extFullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg> Vollbild</button>' +
      '</div>' +
      '<div class="body" id="extBody">' +
        '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>' +
      '</div>' +
      '</body></html>';
  }

  function showExtPlaceholder() {
    if (!_externalWindow || _externalWindow.closed) return;
    var doc = _externalWindow.document;
    var body = doc.getElementById('extBody');
    var title = doc.getElementById('extTitle');
    if (body) body.innerHTML = '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>';
    if (title) title.textContent = 'Warte auf Auswahl…';
  }

  function loadFileInExternal(file) {
    if (!_externalWindow || _externalWindow.closed) return;

    var doc = _externalWindow.document;
    var body = doc.getElementById('extBody');
    var title = doc.getElementById('extTitle');
    if (!body) { setTimeout(function() { loadFileInExternal(file); }, 200); return; }

    var kind = getFileKind(file.name);
    if (kind !== 'pdf' && kind !== 'image') {
      body.innerHTML = '<div class="placeholder"><div>Dieser Dateityp wird nicht unterstützt.<br>Nur PDFs und Bilder.</div></div>';
      if (title) title.textContent = file.name;
      return;
    }

    if (title) title.textContent = file.name;
    _externalWindow.document.title = file.name + ' — S+L Viewer';
    body.innerHTML = '<div class="loading"><div class="spinner"></div><div>Lade…</div></div>';

    var fileId = getFileId(file);
    if (!fileId) { body.innerHTML = '<div class="error">Keine Datei-ID</div>'; return; }

    getDownloadUrl(fileId).then(function(dlUrl) {
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('Download Fehler: ' + r.status);
      return r.blob();
    }).then(function(blob) {
      // Alten Blob-URL aufräumen
      if (_externalWindow.__blobUrl) {
        try { URL.revokeObjectURL(_externalWindow.__blobUrl); } catch(e) {}
      }

      var blobType = kind === 'pdf' ? 'application/pdf' : blob.type;
      var typedBlob = new Blob([blob], { type: blobType });
      var blobUrl = URL.createObjectURL(typedBlob);
      _externalWindow.__blobUrl = blobUrl;

      body.innerHTML = '';

      if (kind === 'pdf') {
        var embed = doc.createElement('embed');
        embed.type = 'application/pdf';
        embed.src = blobUrl;
        body.appendChild(embed);
      } else {
        var img = doc.createElement('img');
        img.src = blobUrl;
        body.appendChild(img);
      }
    }).catch(function(e) {
      console.error('[ExtViewer] Fehler:', e);
      body.innerHTML = '<div class="error">Fehler: ' + (e.message || e) + '</div>';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOKS
  // ═══════════════════════════════════════════════════════════════
  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;

    // Externes Fenster aktiv? → dort laden
    if (_externalWindow && !_externalWindow.closed) {
      var kind = getFileKind(file.name);
      if (kind === 'pdf' || kind === 'image') {
        _currentFile = file;
        loadFileInExternal(file);
        return;
      }
    }

    // Inline-Viewer versuchen
    var handled = loadIntoInline(file);
    if (!handled && typeof _origOpenPreview === 'function') {
      _origOpenPreview(idx);
    }
  };

  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    cleanupBlob();
    _currentFile = null;
    if (_externalWindow && !_externalWindow.closed) showExtPlaceholder();
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v6 geladen (Native Browser PDF Viewer)');
})();
