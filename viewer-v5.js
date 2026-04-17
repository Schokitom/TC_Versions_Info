// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v7
//  Signierte URL direkt im iframe/externem Fenster
// ═══════════════════════════════════════════════════════════════
//
//  Kein Blob, kein embed — signierte Download-URL direkt nutzen:
//  - Eingebettet: iframe mit src = signierte URL
//  - Extern: Fenster navigiert direkt zur signierten URL
//  - Browser rendert PDF nativ (gestochen scharf)
//  - Kein Sandbox-Problem
//
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var _currentFile = null;
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

  // Die signierte URL hat response-content-type=application/octet-stream
  // Wir müssen sie zu application/pdf ändern damit der Browser sie inline rendert
  function toPdfViewUrl(signedUrl) {
    // Ersetze response-content-type=application/octet-stream
    // mit response-content-type=application/pdf
    return signedUrl
      .replace('response-content-type=application%2Foctet-stream', 'response-content-type=application%2Fpdf')
      // Auch content-disposition von attachment zu inline ändern
      .replace('response-content-disposition=attachment', 'response-content-disposition=inline');
  }

  function getFileKind(name) {
    var lower = (name || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lower)) return 'image';
    return 'other';
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
      '.sl-viewer-body{flex:1;overflow:hidden;background:#525659;position:relative}' +
      '.sl-viewer-body iframe{width:100%;height:100%;border:none;display:block}' +
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

    // Download-URL holen und direkt als iframe-src verwenden
    getDownloadUrl(fileId).then(function(signedUrl) {
      slBody.innerHTML = '';

      if (kind === 'pdf') {
        var viewUrl = toPdfViewUrl(signedUrl);
        var iframe = document.createElement('iframe');
        iframe.src = viewUrl;
        iframe.setAttribute('allow', 'fullscreen');
        slBody.appendChild(iframe);
      } else {
        // Bild: signierte URL direkt als img src
        var img = document.createElement('img');
        img.src = signedUrl;
        slBody.appendChild(img);
      }
    }).catch(function(e) {
      console.error('[Viewer] Fehler:', e);
      slBody.innerHTML = '<div class="sl-viewer-error">Fehler: ' + escHtml(e.message) + '</div>';
    });

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER (Continuous Preview)
  // ═══════════════════════════════════════════════════════════════
  function toggleExternalWindow() {
    if (_externalWindow && !_externalWindow.closed) {
      _externalWindow.close();
      _externalWindow = null;
      updateDetachButton();
      // Inline wieder einblenden
      var panel = document.getElementById('previewPanel');
      var handle = document.getElementById('previewResizeHandle');
      if (panel) panel.classList.add('open');
      if (handle) handle.style.display = '';
      if (_currentFile) loadIntoInline(_currentFile);
      return;
    }

    openExternalWindow();

    // Inline ausblenden
    var panel = document.getElementById('previewPanel');
    var handle = document.getElementById('previewResizeHandle');
    if (panel) panel.classList.remove('open');
    if (handle) handle.style.display = 'none';
  }

  function openExternalWindow() {
    // Externes Fenster mit Platzhalter öffnen
    var extWin = window.open('', 'sl-viewer-ext', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) {
      alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
      return;
    }

    _externalWindow = extWin;

    // Platzhalter-HTML schreiben
    writeExtPlaceholder(extWin);

    // Wenn aktuelles File vorhanden: direkt laden
    if (_currentFile) {
      loadFileInExternal(_currentFile);
    }

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

  function writeExtPlaceholder(extWin) {
    var doc = extWin.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}' +
      '.placeholder{display:flex;flex-direction:column;align-items:center;gap:16px;color:#7a8199;text-align:center;padding:40px}' +
      '.placeholder svg{width:64px;height:64px;opacity:.3;fill:currentColor}' +
      '</style></head><body>' +
      '<div class="placeholder">' +
        '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>' +
        '<div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div>' +
      '</div>' +
      '</body></html>');
    doc.close();
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

  function loadFileInExternal(file) {
    if (!_externalWindow || _externalWindow.closed) return;

    var kind = getFileKind(file.name);
    if (kind !== 'pdf' && kind !== 'image') {
      writeExtPlaceholder(_externalWindow);
      return;
    }

    var fileId = getFileId(file);
    if (!fileId) return;

    // Externes Fenster: Loading-State
    var doc = _externalWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>' + escHtml(file.name) + ' — S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}' +
      '.spinner{width:40px;height:40px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:spin .7s linear infinite}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '.info{margin-top:12px;color:#7a8199;font-size:13px}' +
      '</style></head><body><div class="spinner"></div><div class="info">Lade ' + escHtml(file.name) + '…</div></body></html>');
    doc.close();

    // Download-URL holen und Fenster direkt dorthin navigieren
    getDownloadUrl(fileId).then(function(signedUrl) {
      if (!_externalWindow || _externalWindow.closed) return;

      if (kind === 'pdf') {
        // Direkt zur PDF-URL navigieren — Browser zeigt nativen PDF-Viewer
        var viewUrl = toPdfViewUrl(signedUrl);
        _externalWindow.location.href = viewUrl;
      } else {
        // Bild: In einfachem HTML-Wrapper anzeigen
        var doc = _externalWindow.document;
        doc.open();
        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escHtml(file.name) + '</title><style>' +
          '*{margin:0;padding:0}body{background:#1a1d27;height:100vh;display:flex;align-items:center;justify-content:center;overflow:auto}' +
          'img{max-width:100%;max-height:100%;box-shadow:0 4px 20px rgba(0,0,0,.5)}' +
          '</style></head><body><img src="' + escHtml(signedUrl) + '"></body></html>');
        doc.close();
      }
    }).catch(function(e) {
      console.error('[ExtViewer] Fehler:', e);
      if (_externalWindow && !_externalWindow.closed) {
        var doc = _externalWindow.document;
        doc.open();
        doc.write('<!DOCTYPE html><html><head><title>Fehler</title><style>body{background:#1a1d27;color:#ef4444;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif}</style></head><body>Fehler: ' + escHtml(e.message) + '</body></html>');
        doc.close();
      }
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

    // Inline versuchen
    var handled = loadIntoInline(file);
    if (!handled && typeof _origOpenPreview === 'function') {
      _origOpenPreview(idx);
    }
  };

  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    _currentFile = null;
    if (_externalWindow && !_externalWindow.closed) {
      writeExtPlaceholder(_externalWindow);
    }
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v7 geladen (Signierte URL direkt)');
})();
