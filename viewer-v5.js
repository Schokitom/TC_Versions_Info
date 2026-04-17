// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v9
// ═══════════════════════════════════════════════════════════════
//
//  Strategie:
//  - Eingebettet: Original Trimble-Viewer (funktioniert im Sandbox)
//    + Abkoppeln-Button in der Toolbar
//  - Extern: Eigenes Fenster mit iframe → Worker-Proxy-URL
//    Fenster bleibt offen, iframe-src wird bei jedem neuen
//    Dokument aktualisiert (Continuous Preview)
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

  function toPdfViewUrl(signedUrl) {
    return PROXY_URL + '/pdf-view?url=' + encodeURIComponent(signedUrl);
  }

  function getFileKind(name) {
    var lower = (name || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lower)) return 'image';
    return 'other';
  }

  // ═══════════════════════════════════════════════════════════════
  //  Abkoppeln-Button in die bestehende Preview-Toolbar injizieren
  // ═══════════════════════════════════════════════════════════════
  function injectDetachButton() {
    if (document.getElementById('sl-detach-btn')) return; // schon da

    var previewHeader = document.querySelector('.preview-header');
    if (!previewHeader) return;

    var style = document.createElement('style');
    style.textContent =
      '#sl-detach-btn{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:3px 8px;font-size:11px;font-family:var(--font-ui,sans-serif);display:inline-flex;align-items:center;gap:3px;transition:all .15s;white-space:nowrap;flex-shrink:0}' +
      '#sl-detach-btn:hover{border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      '#sl-detach-btn.active{background:#005f8a;color:#fff;border-color:#00c2ff}' +
      '#sl-detach-btn svg{width:12px;height:12px;fill:currentColor}';
    document.head.appendChild(style);

    // Button vor dem Close-Button einfügen
    var closeBtn = previewHeader.querySelector('.preview-close');
    var btn = document.createElement('button');
    btn.id = 'sl-detach-btn';
    btn.title = 'In externem Fenster öffnen';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg>' +
      '<span id="sl-detach-label">Abkoppeln</span>';
    btn.onclick = toggleExternalWindow;

    if (closeBtn) {
      previewHeader.insertBefore(btn, closeBtn);
    } else {
      previewHeader.appendChild(btn);
    }
  }

  function updateDetachButton() {
    var btn = document.getElementById('sl-detach-btn');
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

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER
  //  Bleibt als eigenes HTML-Dokument mit iframe darin
  //  → iframe-src kann jederzeit aktualisiert werden
  // ═══════════════════════════════════════════════════════════════
  function toggleExternalWindow() {
    if (_externalWindow && !_externalWindow.closed) {
      // Schließen → Inline wieder zeigen
      _externalWindow.close();
      _externalWindow = null;
      updateDetachButton();
      var panel = document.getElementById('previewPanel');
      var handle = document.getElementById('previewResizeHandle');
      if (panel) panel.classList.add('open');
      if (handle) handle.style.display = '';
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
    var extWin = window.open('', 'sl-viewer-ext', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) {
      alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
      return;
    }

    _externalWindow = extWin;

    // HTML-Dokument schreiben das dauerhaft bleibt
    // Enthält: Toolbar + iframe (dessen src wir jederzeit ändern können)
    var doc = extWin.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}' +
      '.toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0}' +
      '.title{flex:1;font-size:13px;font-weight:600;color:#e4e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px}' +
      'button{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:4px 10px;font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;transition:all .15s}' +
      'button:hover{border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      'button svg{width:14px;height:14px;fill:currentColor}' +
      '.viewer-frame{flex:1;overflow:hidden;background:#525659}' +
      '.viewer-frame iframe{width:100%;height:100%;border:none;display:block}' +
      '.placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:16px;text-align:center;padding:40px}' +
      '.placeholder svg{width:64px;height:64px;opacity:.3;fill:currentColor}' +
      '.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:12px}' +
      '.spinner{width:40px;height:40px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:spin .7s linear infinite}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '</style></head><body>' +
      '<div class="toolbar">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title" id="extTitle">Warte auf Auswahl…</div>' +
        '<button id="extFullscreen" title="Vollbild (F11)"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg> Vollbild</button>' +
      '</div>' +
      '<div class="viewer-frame" id="extFrame">' +
        '<div class="placeholder" id="extPlaceholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>' +
      '</div>' +
      '</body></html>');
    doc.close();

    // Fullscreen-Button
    setTimeout(function() {
      var fsBtn = extWin.document.getElementById('extFullscreen');
      if (fsBtn) fsBtn.onclick = function() {
        if (extWin.document.documentElement.requestFullscreen) extWin.document.documentElement.requestFullscreen();
      };
    }, 100);

    // Aktuelles File laden falls vorhanden
    if (_currentFile) {
      setTimeout(function() {
        loadFileInExternal(_currentFile);
      }, 150);
    }

    // Erkennen wenn Fenster geschlossen wird
    var checkClosed = setInterval(function() {
      if (!_externalWindow || _externalWindow.closed) {
        clearInterval(checkClosed);
        _externalWindow = null;
        updateDetachButton();
        // Inline wieder einblenden
        var p = document.getElementById('previewPanel');
        var h = document.getElementById('previewResizeHandle');
        if (p && _currentFile) {
          p.classList.add('open');
          if (h) h.style.display = '';
        }
      }
    }, 500);

    updateDetachButton();
  }

  function loadFileInExternal(file) {
    if (!_externalWindow || _externalWindow.closed) return;

    var doc;
    try { doc = _externalWindow.document; } catch(e) {
      // Cross-origin — Fenster wurde navigiert, neu öffnen
      openExternalWindow();
      setTimeout(function() { loadFileInExternal(file); }, 300);
      return;
    }

    var frame = doc.getElementById('extFrame');
    var title = doc.getElementById('extTitle');
    if (!frame) {
      // DOM nicht mehr verfügbar — Fenster neu schreiben
      openExternalWindow();
      setTimeout(function() { loadFileInExternal(file); }, 300);
      return;
    }

    var kind = getFileKind(file.name);
    if (kind !== 'pdf' && kind !== 'image') {
      frame.innerHTML = '<div class="placeholder"><div>Dieser Dateityp wird nicht unterstützt.</div></div>';
      if (title) title.textContent = file.name;
      return;
    }

    if (title) title.textContent = file.name;
    _externalWindow.document.title = file.name + ' — S+L Viewer';

    // Loading
    frame.innerHTML = '<div class="loading"><div class="spinner"></div><div style="font-size:13px">Lade ' + file.name + '…</div></div>';

    var fileId = getFileId(file);
    if (!fileId) {
      frame.innerHTML = '<div class="placeholder"><div>Keine Datei-ID</div></div>';
      return;
    }

    getDownloadUrl(fileId).then(function(signedUrl) {
      if (!_externalWindow || _externalWindow.closed) return;

      var extDoc;
      try { extDoc = _externalWindow.document; } catch(e) { return; }
      var extFrame = extDoc.getElementById('extFrame');
      if (!extFrame) return;

      extFrame.innerHTML = '';

      if (kind === 'pdf') {
        var proxyUrl = toPdfViewUrl(signedUrl);
        var iframe = extDoc.createElement('iframe');
        iframe.src = proxyUrl;
        iframe.setAttribute('allow', 'fullscreen');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        extFrame.appendChild(iframe);
      } else {
        // Bild
        var imgWrap = extDoc.createElement('div');
        imgWrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;background:#1a1d27';
        var img = extDoc.createElement('img');
        img.src = signedUrl;
        img.style.cssText = 'max-width:100%;max-height:100%;box-shadow:0 4px 20px rgba(0,0,0,.5)';
        imgWrap.appendChild(img);
        extFrame.appendChild(imgWrap);
      }
    }).catch(function(e) {
      console.error('[ExtViewer] Fehler:', e);
      try {
        var extFrame = _externalWindow.document.getElementById('extFrame');
        if (extFrame) extFrame.innerHTML = '<div class="placeholder" style="color:#ef4444">Fehler: ' + e.message + '</div>';
      } catch(e2) {}
    });
  }

  function showExtPlaceholder() {
    if (!_externalWindow || _externalWindow.closed) return;
    try {
      var doc = _externalWindow.document;
      var frame = doc.getElementById('extFrame');
      var title = doc.getElementById('extTitle');
      if (frame) frame.innerHTML = '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>';
      if (title) title.textContent = 'Warte auf Auswahl…';
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOKS
  // ═══════════════════════════════════════════════════════════════

  // Detach-Button injizieren sobald Preview-Panel existiert
  var _btnInjected = false;
  var _injectInterval = setInterval(function() {
    if (document.querySelector('.preview-header')) {
      injectDetachButton();
      _btnInjected = true;
      clearInterval(_injectInterval);
    }
  }, 500);

  // openPreview überschreiben
  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;

    _currentFile = file;

    // Detach-Button sicherstellen
    if (!_btnInjected) injectDetachButton();

    // Externes Fenster aktiv? → dort laden, Inline trotzdem auch laden
    if (_externalWindow && !_externalWindow.closed) {
      var kind = getFileKind(file.name);
      if (kind === 'pdf' || kind === 'image') {
        loadFileInExternal(file);
        // Inline NICHT zeigen wenn extern aktiv
        return;
      }
    }

    // Normal: Original-Viewer für alle Dateitypen
    if (typeof _origOpenPreview === 'function') {
      _origOpenPreview(idx);
    }

    // Detach-Button aktualisieren
    setTimeout(function() {
      if (!_btnInjected) injectDetachButton();
      updateDetachButton();
    }, 100);
  };

  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    _currentFile = null;
    if (_externalWindow && !_externalWindow.closed) showExtPlaceholder();
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v9 geladen (Trimble inline + Ext. PDF-Proxy)');
})();
