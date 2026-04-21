// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Enhanced Viewer v13
//  Fix: Eingebetteter Viewer kann verborgen werden
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var _currentFile = null;
  var _currentIdx = -1;
  var _extTrimble = null;
  var _extNative = null;
  var _inlineHidden = false; // User hat Inline-Viewer bewusst geschlossen

  // ─── Token-Refresh bei abgelaufenem Token ───
  function refreshToken() {
    return new Promise(function(resolve) {
      if (typeof workspaceAPI !== 'undefined' && workspaceAPI) {
        var resolved = false;
        workspaceAPI.requestPermission(function(token) {
          if (resolved) return;
          resolved = true;
          if (token) { accessToken = token; console.log('[Viewer] Token erneuert'); resolve(true); }
          else if (typeof workspaceAPI.getAccessToken === 'function') {
            workspaceAPI.getAccessToken(function(t) { if (t) accessToken = t; resolve(!!t); });
          } else { resolve(false); }
        });
        setTimeout(function() { if (!resolved) { resolved = true; resolve(false); } }, 8000);
      } else { resolve(false); }
    });
  }

  function getDownloadUrl(fileId, _isRetry) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }).then(function(r) {
      if ((r.status === 401 || r.status === 403) && !_isRetry) {
        console.log('[Viewer] Token abgelaufen (' + r.status + '), erneuere...');
        return refreshToken().then(function(ok) {
          if (ok) return getDownloadUrl(fileId, true);
          throw new Error('Token konnte nicht erneuert werden');
        });
      }
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

  function hasExternalWindow() {
    return (_extTrimble && !_extTrimble.closed) || (_extNative && !_extNative.closed);
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUGE-HIGHLIGHTING
  // ═══════════════════════════════════════════════════════════════
  function updateEyeHighlight(idx) {
    var allBtns = document.querySelectorAll('.prev-btn');
    for (var i = 0; i < allBtns.length; i++) allBtns[i].classList.remove('active');
    var activeBtn = document.getElementById('prev-btn-' + idx);
    if (activeBtn) activeBtn.classList.add('active');
  }

  // ═══════════════════════════════════════════════════════════════
  //  CSS
  // ═══════════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById('sl-viewer-styles')) return;
    var css =
      '.sl-detach-wrap{display:flex;align-items:center;gap:4px;flex-shrink:0}' +
      '.sl-detach-hint{font-size:10px;color:#7a8199;white-space:nowrap;flex-shrink:0}' +
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
  //  Buttons in Preview-Toolbar
  // ═══════════════════════════════════════════════════════════════
  function injectDetachButtons() {
    if (document.getElementById('sl-detach-wrap')) return;
    var previewHeader = document.querySelector('.preview-header');
    if (!previewHeader) return;

    injectStyles();

    var wrap = document.createElement('div');
    wrap.className = 'sl-detach-wrap';
    wrap.id = 'sl-detach-wrap';

    var hint = document.createElement('span');
    hint.className = 'sl-detach-hint';
    hint.textContent = 'Abkoppeln mit:';
    wrap.appendChild(hint);

    var btnT = document.createElement('button');
    btnT.className = 'sl-dbtn';
    btnT.id = 'sl-detach-trimble';
    btnT.title = 'Externes Fenster mit Trimble Viewer';
    btnT.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h4v-2H5V8h14v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-7 6l-4 4h3v6h2v-6h3l-4-4z"/></svg><span id="sl-label-trimble">Trimble</span>';
    btnT.onclick = function() { toggleExtTrimble(); };
    wrap.appendChild(btnT);

    var btnN = document.createElement('button');
    btnN.className = 'sl-dbtn';
    btnN.id = 'sl-detach-native';
    btnN.title = 'Externes Fenster mit nativem PDF-Viewer (sch\u00e4rfer, mit Strg+F)';
    btnN.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 13h8v1H8v-1zm0 3h8v1H8v-1zm0-6h4v1H8v-1z"/></svg><span id="sl-label-native">Nativ</span>';
    btnN.onclick = function() { toggleExtNative(); };
    wrap.appendChild(btnN);

    var closeBtn = previewHeader.querySelector('.preview-close');
    if (closeBtn) previewHeader.insertBefore(wrap, closeBtn);
    else previewHeader.appendChild(wrap);
  }

  function updateButtons() {
    var btnT = document.getElementById('sl-detach-trimble');
    var btnN = document.getElementById('sl-detach-native');
    var lblT = document.getElementById('sl-label-trimble');
    var lblN = document.getElementById('sl-label-native');
    if (btnT) {
      if (_extTrimble && !_extTrimble.closed) { btnT.classList.add('active'); if (lblT) lblT.textContent = 'Trimble \u2713'; }
      else { btnT.classList.remove('active'); if (lblT) lblT.textContent = 'Trimble'; }
    }
    if (btnN) {
      if (_extNative && !_extNative.closed) { btnN.classList.add('active'); if (lblN) lblN.textContent = 'Nativ \u2713'; }
      else { btnN.classList.remove('active'); if (lblN) lblN.textContent = 'Nativ'; }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TRIMBLE VIEWER — EXTERNES FENSTER
  // ═══════════════════════════════════════════════════════════════
  function toggleExtTrimble() {
    if (_extTrimble && !_extTrimble.closed) {
      _extTrimble.close(); _extTrimble = null; updateButtons(); return;
    }
    openExtTrimble();
  }

  function openExtTrimble() {
    var extWin = window.open('about:blank', 'sl-viewer-trimble', 'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!extWin) { alert('Popup blockiert!'); return; }
    _extTrimble = extWin;
    if (_currentFile) loadTrimbleInExternal(_currentFile);
    watchClose(function() { return _extTrimble; }, function() { _extTrimble = null; updateButtons(); });
    updateButtons();
  }

  function loadTrimbleInExternal(file) {
    if (!_extTrimble || _extTrimble.closed) return;
    var fileId = getFileId(file);
    var versionId = file.versionId || fileId;
    if (!fileId) return;
    var viewerUrl = 'https://web.connect.trimble.com/projects/' + projectId +
      '/viewer/2D?id=' + versionId + '&version=' + versionId +
      '&type=revisions&etag=' + versionId;
    _extTrimble.location.href = viewerUrl;
  }

  // ═══════════════════════════════════════════════════════════════
  //  NATIVER PDF-VIEWER — EXTERNES FENSTER
  // ═══════════════════════════════════════════════════════════════
  function toggleExtNative() {
    if (_extNative && !_extNative.closed) {
      _extNative.close(); _extNative = null; updateButtons(); return;
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
    if (title) { title.textContent = file.name; _extNative.document.title = file.name + ' \u2014 S+L Viewer'; }

    if (kind !== 'pdf' && kind !== 'image') {
      frame.innerHTML = '<div class="placeholder"><div>Dieser Dateityp wird nur im Trimble Viewer unterst\u00fctzt.</div></div>';
      return;
    }

    frame.innerHTML = '<div class="loading"><div class="spinner"></div><div style="font-size:13px">Lade ' + escHtml(file.name) + '\u2026</div></div>';

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
        var proxyUrl = toPdfViewUrl(signedUrl) + '#zoom=page-fit';
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
  //  SHARED HELPERS
  // ═══════════════════════════════════════════════════════════════
  function writeExtShell(extWin, subtitle) {
    var doc = extWin.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>S+L Viewer</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{background:#1a1d27;color:#e4e8f0;font-family:"DM Sans","Segoe UI",sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}' +
      '.toolbar{display:flex;align-items:center;gap:8px;padding:4px 12px;background:#0f1117;border-bottom:1px solid #2a2d3e;flex-shrink:0;height:36px}' +
      '.title{flex:1;font-size:12px;font-weight:600;color:#e4e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px}' +
      '.subtitle{font-size:9px;color:#7a8199;font-weight:400;margin-left:8px;flex-shrink:0}' +
      'button{background:none;border:1px solid #2a2d3e;border-radius:4px;color:#7a8199;cursor:pointer;padding:2px 8px;font-size:11px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;transition:all .15s}' +
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
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="#00c2ff"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>' +
        '<div class="title" id="extTitle">Warte auf Auswahl\u2026</div>' +
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

  function showExtPlaceholder(extWin) {
    try {
      var frame = extWin.document.getElementById('extFrame');
      var title = extWin.document.getElementById('extTitle');
      if (frame) frame.innerHTML = '<div class="placeholder"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><div>Klicken Sie im Explorer auf das Auge-Symbol<br>um eine Datei hier anzuzeigen</div></div>';
      if (title) title.textContent = 'Warte auf Auswahl\u2026';
    } catch(e) {}
  }

  function watchClose(getWin, onClosed) {
    var interval = setInterval(function() {
      var w = getWin();
      if (!w || w.closed) { clearInterval(interval); onClosed(); }
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

  // ─── closePreview überschreiben ───
  var _origClosePreview = window.closePreview;
  window.closePreview = function() {
    _inlineHidden = true;

    if (!hasExternalWindow()) {
      _currentFile = null;
      _currentIdx = -1;
      var allBtns = document.querySelectorAll('.prev-btn');
      for (var i = 0; i < allBtns.length; i++) allBtns[i].classList.remove('active');
    }

    if (_extNative && !_extNative.closed && !hasExternalWindow()) {
      showExtPlaceholder(_extNative);
    }

    if (typeof _origClosePreview === 'function') _origClosePreview();
  };

  // ─── openPreview überschreiben ───
  var _origOpenPreview = window.openPreview;
  window.openPreview = function(idx) {
    var file = allFiles[idx];
    if (!file) return;

    _currentFile = file;
    _currentIdx = idx;

    if (!_btnInjected) injectDetachButtons();

    updateEyeHighlight(idx);

    if (_extTrimble && !_extTrimble.closed) {
      loadTrimbleInExternal(file);
    }
    if (_extNative && !_extNative.closed) {
      loadNativeInExternal(file);
    }

    if (hasExternalWindow() && _inlineHidden) {
      setTimeout(function() { updateButtons(); }, 100);
      return;
    }

    _inlineHidden = false;
    if (typeof _origOpenPreview === 'function') {
      _origOpenPreview(idx);
    }

    setTimeout(function() {
      if (!_btnInjected) injectDetachButtons();
      updateButtons();
    }, 100);
  };

  console.log('[Viewer] Enhanced Viewer v13 geladen (Inline verbergbar)');
})();
