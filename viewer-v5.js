// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v10
//  Zwei Abkoppel-Optionen: Trimble Viewer + Nativer PDF-Viewer
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var _currentFile = null;
  var _currentFileIdx = -1;
  var _extTrimble = null;   // Externes Fenster: Trimble Viewer
  var _extNative = null;    // Externes Fenster: Nativer PDF-Viewer

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
  //  CSS für Buttons
  // ═══════════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById('sl-viewer-styles')) return;
    var css =
      '.sl-detach-wrap{display:flex;gap:3px;flex-shrink:0}' +
      '.sl-dbtn{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:3px 7px;font-size:10px;font-family:var(--font-ui,sans-serif);display:inline-flex;align-items:center;gap:3px;transition:all .15s;white-space:nowrap;flex-shrink:0}' +
      '.sl-dbtn:hover{border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      '.sl-dbtn.active{background:#005f8a;color:#fff;border-color:#00c2ff}' +
      '.sl-dbtn svg{width:11px;height:11px;fill:currentColor}';
    var style = document.createElement('style');
    style.id = 'sl-viewer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Buttons in Preview-Toolbar injizieren
  // ═══════════════════════════════════════════════════════════════
  function injectDetachButtons() {
    if (document.getElementById('sl-detach-wrap')) return;

    var previewHeader = document.querySelector('.preview-header');
    if (!previewHeader) return;

    injectStyles();

    var wrap = document.createElement('div');
    wrap.className = 'sl-detach-wrap';
    wrap.id = 'sl-detach-wrap';

    // Button 1: Trimble Viewer (gleich wie eingebettet)
    var btnTrimble = document.createElement('button');
    btnTrimble.className = 'sl-dbtn';
    btnTrimble.id = 'sl-detach-trimble';
    btnTrimble.title = 'In externem Fenster öffnen (Trimble Viewer)';
    btnTrimble.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg>' +
      '<span id="sl-label-trimble">Trimble</span>';
    btnTrimble.onclick = function() { toggleExtTrimble(); };

    // Button 2: Nativer PDF-Viewer
    var btnNative = document.createElement('button');
    btnNative.className = 'sl-dbtn';
    btnNative.id = 'sl-detach-native';
    btnNative.title = 'In externem Fenster öffnen (Nativer PDF-Viewer — schärfer, mit Suche)';
    btnNative.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 13h8v1H8v-1zm0 3h8v1H8v-1zm0-6h4v1H8v-1z"/></svg>' +
      '<span id="sl-label-native">Nativ</span>';
    btnNative.onclick = function() { toggleExtNative(); };

    wrap.appendChild(btnTrimble);
    wrap.appendChild(btnNative);

    var closeBtn = previewHeader.querySelector('.preview-close');
    if (closeBtn) {
      previewHeader.insertBefore(wrap, closeBtn);
    } else {
      previewHeader.appendChild(wrap);
    }
  }

  function updateButtons() {
    var btnT = document.getElementById('sl-detach-trimble');
    var btnN = document.getElementById('sl-detach-native');
    var lblT = document.getElementById('sl-label-trimble');
    var lblN = document.getElementById('sl-label-native');

    if (btnT) {
      if (_extTrimble && !_extTrimble.closed) { btnT.classList.add('active'); if (lblT) lblT.textContent = 'Trimble ✓'; }
      else { btnT.classList.remove('active'); if (lblT) lblT.textContent = 'Trimble'; }
    }
    if (btnN) {
      if (_extNative && !_extNative.closed) { btnN.classList.add('active'); if (lblN) lblN.textContent = 'Nativ ✓'; }
      else { btnN.classList.remove('active'); if (lblN) lblN.textContent = 'Nativ'; }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER: TRIMBLE VIEWER
  //  Nutzt den Trimble 2D-Viewer in einem iframe (gleiche Ansicht
  //  wie eingebettet, aber in eigenem Fenster)
  // ═══════════════════════════════════════════════════════════════
  function toggleExtTrimble() {
    if (_extTrimble && !_extTrimble.closed) {
      _extTrimble.close();
      _extTrimble = null;
      updateButtons();
      return;
    }
    openExtTrimble();
  }

  function openExtTrimble() {
    var extWin = window.open('', 'sl-viewer-trimble', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) { alert('Popup blockiert!'); return; }
    _extTrimble = extWin;

    writeExtShell(extWin, 'Trimble Viewer');

    if (_currentFile) setTimeout(function() { loadTrimbleInExternal(_currentFile); }, 150);

    watchClose(function() { return _extTrimble; }, function() { _extTrimble = null; updateButtons(); });
    updateButtons();
  }

  function loadTrimbleInExternal(file) {
    if (!_extTrimble || _extTrimble.closed) return;

    var doc;
    try { doc = _extTrimble.document; } catch(e) { return; }

    var frame = doc.getElementById('extFrame');
    var title = doc.getElementById('extTitle');
    if (!frame) return;

    if (title) { title.textContent = file.name; _extTrimble.document.title = file.name + ' — Trimble Viewer'; }

    frame.innerHTML = '<div class="loading"><div class="spinner"></div><div style="font-size:13px">Lade ' + escHtml(file.name) + '…</div></div>';

    var fileId = getFileId(file);
    var versionId = file.versionId || fileId;
    if (!fileId) { frame.innerHTML = '<div class="placeholder"><div>Keine Datei-ID</div></div>'; return; }

    // Trimble 2D-Viewer URL bauen (gleich wie im Inline-Viewer)
    var viewerUrl = 'https://web.connect.trimble.com/projects/' + projectId +
      '/viewer/2D?id=' + versionId + '&version=' + versionId +
      '&type=revisions&etag=' + versionId + '&isEmbedded=true';

    frame.innerHTML = '';
    var iframe = doc.createElement('iframe');
    iframe.src = viewerUrl;
    iframe.setAttribute('allow', 'fullscreen');
    iframe.style.cssText = 'width:100%;height:100%;border:none';
    frame.appendChild(iframe);

    // Token an den Viewer-iframe übergeben (wie im Inline-Code)
    iframe.onload = function() {
      try {
        iframe.contentWindow.postMessage({
          type: 'accessToken',
          token: accessToken,
        }, '*');
      } catch(e) {}
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNES FENSTER: NATIVER PDF-VIEWER
  //  Nutzt den Browser-eigenen PDF-Renderer via Worker-Proxy
  // ═══════════════════════════════════════════════════════════════
  function toggleExtNative() {
    if (_extNative && !_extNative.closed) {
      _extNative.close();
      _extNative = null;
      updateButtons();
      return;
    }
    openExtNative();
  }

  function openExtNative() {
    var extWin = window.open('', 'sl-viewer-native', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) { alert('Popup blockiert!'); return; }
    _extNative = extWin;

    writeExtShell(extWin, 'Nativer PDF-Viewer');

    if (_currentFile) setTimeout(function() { loadNativeInExternal(_currentFile); }, 150);

    watchClose(function() { return _extNative; }, function() { _extNative = null; updateButtons(); });
    updateButtons();
  }

  function loadNativeInExternal(file) {
    if (!_extNative || _extNative.closed) return;

    var doc;
    try { doc = _extNative.document; } catch(e) { return; }

    var frame = doc.getElementById('extFrame');
    var title = doc.getElementById('extTitle');
    if (!frame) return;

    var kind = getFileKind(file.name);

    if (title) { title.textContent = file.name; _extNative.document.title = file.name + ' — S+L Viewer'; }

    if (kind !== 'pdf' && kind !== 'image') {
      frame.innerHTML = '<div class="placeholder"><div>Dieser Dateityp wird nur im Trimble Viewer unterstützt.</div></div>';
      return;
    }

    frame.innerHTML = '<div class="loading"><div class="spinner"></div><div style="font-size:13px">Lade ' + escHtml(file.name) + '…</div></div>';

    var fileId = getFileId(file);
    if (!fileId) { frame.innerHTML = '<div class="placeholder"><div>Keine Datei-ID</div></div>'; return; }

    getDownloadUrl(fileId).then(function(signedUrl) {
      if (!_extNative || _extNative.closed) return;

      var extDoc;
      try { extDoc = _extNative.document; } catch(e) { return; }
      var extFrame = extDoc.getElementById('extFrame');
      if (!extFrame) return;

      extFrame.innerHTML = '';

      if (kind === 'pdf') {
        var proxyUrl = toPdfViewUrl(signedUrl);
        var iframe = extDoc.createElement('iframe');
        iframe.src = proxyUrl;
        iframe.setAttribute('allow', 'fullscreen');
        iframe.style.cssText = 'width:100%;height:100%;border:none';
        extFrame.appendChild(iframe);
      } else {
        var imgWrap = extDoc.createElement('div');
        imgWrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;background:#1a1d27';
        var img = extDoc.createElement('img');
        img.src = signedUrl;
        img.style.cssText = 'max-width:100%;max-height:100%;box-shadow:0 4px 20px rgba(0,0,0,.5)';
        imgWrap.appendChild(img);
        extFrame.appendChild(imgWrap);
      }
    }).catch(function(e) {
      console.error('[NativeViewer] Fehler:', e);
      try {
        var f = _extNative.document.getElementById('extFrame');
        if (f) f.innerHTML = '<div class="placeholder" style="color:#ef4444">Fehler: ' + e.message + '</div>';
      } catch(e2) {}
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SHARED: Fenster-Shell HTML + Watchdog
  // ═══════════════════════════════════════════════════════════════
  function writeExtShell(extWin, subtitle) {
    var doc = extWin.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}' +
      '.toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0}' +
      '.title{flex:1;font-size:13px;font-weight:600;color:#e4e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px}' +
      '.subtitle{font-size:10px;color:#7a8199;font-weight:400;margin-left:8px;flex-shrink:0}' +
      'button{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:4px 10px;font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;transition:all .15s}' +
      'button:hover{border-color:#00c2ff;color:#00c2ff;background:#1e2235}' +
      'button svg{width:14px;height:14px;fill:currentColor}' +
      '#extFrame{flex:1;overflow:hidden;background:#525659}' +
      '#extFrame iframe{width:100%;height:100%;border:none;display:block}' +
      '.placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:16px;text-align:center;padding:40px}' +
      '.placeholder svg{width:64px;height:64px;opacity:.3;fill:currentColor}' +
      '.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;color:#7a8199;gap:12px}' +
      '.spinner{width:40px;height:40px;border:3px solid #2a2d3e;border-top-color:#00c2ff;border-radius:50%;animation:spin .7s linear infinite}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '</style></head><body>' +
      '<div class="toolbar">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title" id="extTitle">Warte auf Auswahl…</div>' +
        '<span class="subtitle">' + escHtml(subtitle) + '</span>' +
        '<button id="extFullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg> Vollbild</button>' +
      '</div>' +
      '<div id="extFrame">' +
        '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>' +
      '</div>' +
      '</body></html>');
    doc.close();

    setTimeout(function() {
      try {
        var fsBtn = extWin.document.getElementById('extFullscreen');
        if (fsBtn) fsBtn.onclick = function() {
          if (extWin.document.documentElement.requestFullscreen) extWin.document.documentElement.requestFullscreen();
        };
      } catch(e) {}
    }, 100);
  }

  function watchClose(getWin, onClosed) {
    var interval = setInterval(function() {
      var w = getWin();
      if (!w || w.closed) {
        clearInterval(interval);
        onClosed();
      }
    }, 500);
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOKS
  // ═══════════════════════════════════════════════════════════════
  var _btnInjected = false;
  var _injectInterval = setInterval(function() {
    if (document.querySelector('.preview-header')) {
      injectDetachButtons();
      _btnInjected = true;
      clearInterval(_injectInterval);
    }
  }, 500);

  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;

    _currentFile = file;
    _currentFileIdx = idx;

    if (!_btnInjected) injectDetachButtons();

    // Offene externe Fenster aktualisieren
    var extActive = false;

    if (_extTrimble && !_extTrimble.closed) {
      loadTrimbleInExternal(file);
      extActive = true;
    }

    if (_extNative && !_extNative.closed) {
      loadNativeInExternal(file);
      extActive = true;
    }

    // Wenn ein externes Fenster aktiv: Inline-Vorschau NICHT öffnen
    if (extActive) return;

    // Normal: Original-Viewer
    if (typeof _origOpenPreview === 'function') {
      _origOpenPreview(idx);
    }

    setTimeout(function() {
      if (!_btnInjected) injectDetachButtons();
      updateButtons();
    }, 100);
  };

  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    _currentFile = null;
    // Externe Fenster: Platzhalter zeigen
    [_extTrimble, _extNative].forEach(function(w) {
      if (!w || w.closed) return;
      try {
        var frame = w.document.getElementById('extFrame');
        var title = w.document.getElementById('extTitle');
        if (frame) frame.innerHTML = '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>';
        if (title) title.textContent = 'Warte auf Auswahl…';
      } catch(e) {}
    });
    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  console.log('[Viewer] Enhanced Viewer v10 geladen (Trimble + Nativ)');
})();
