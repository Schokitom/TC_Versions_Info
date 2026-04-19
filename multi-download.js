/* ============================================================
 *  S+L Explorer — Multi-Download (ZIP)  v1.1
 *  Separates Modul: <script src="multi-download.js"></script>
 *  Abhängigkeit: JSZip (wird automatisch geladen)
 * ============================================================ */
(function () {
  'use strict';

  // ── Konfiguration ──────────────────────────────────────────
  var PROXY_URL  = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE    = 'https://app21.connect.trimble.com';
  var JSZIP_CDN  = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  // ── State ──────────────────────────────────────────────────
  // Speichert Datei-Infos direkt: { "fileId": { fileId, name }, ... }
  var selectedFiles = {};
  var dlBarEl       = null;
  var progressEl    = null;
  var isDownloading = false;

  // ── JSZip laden (einmalig) ─────────────────────────────────
  function ensureJSZip(cb) {
    if (window.JSZip) return cb();
    var s   = document.createElement('script');
    s.src   = JSZIP_CDN;
    s.onload = function () { cb(); };
    s.onerror = function () {
      alert('JSZip konnte nicht geladen werden. Bitte Internetverbindung prüfen.');
    };
    document.head.appendChild(s);
  }

  // ── CSS injizieren ─────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('md-styles')) return;
    var style = document.createElement('style');
    style.id  = 'md-styles';
    style.textContent = [
      '.md-cb-th, .md-cb-td {',
      '  width: 36px; min-width: 36px; max-width: 36px;',
      '  text-align: center; vertical-align: middle;',
      '  padding: 4px 6px !important;',
      '}',
      '.md-cb-th input, .md-cb-td input {',
      '  width: 16px; height: 16px; cursor: pointer;',
      '  accent-color: var(--accent, #00c2ff);',
      '}',
      '#md-download-bar {',
      '  position: fixed; bottom: 60px; left: 50%;',
      '  transform: translateX(-50%);',
      '  background: var(--surface, #1a1d27);',
      '  border: 1px solid var(--accent, #00c2ff);',
      '  border-radius: 12px;',
      '  padding: 10px 20px;',
      '  display: none; align-items: center; gap: 14px;',
      '  z-index: 9000;',
      '  box-shadow: 0 4px 24px rgba(0,194,255,.25);',
      '  font-family: var(--font-ui, "DM Sans", sans-serif);',
      '  color: var(--text, #e4e8f0);',
      '  animation: md-slide-up .25s ease-out;',
      '}',
      '@keyframes md-slide-up {',
      '  from { opacity:0; transform: translateX(-50%) translateY(20px); }',
      '  to   { opacity:1; transform: translateX(-50%) translateY(0); }',
      '}',
      '#md-download-bar .md-count { font-weight: 600; font-size: 14px; white-space: nowrap; }',
      '#md-download-bar .md-btn {',
      '  background: var(--accent, #00c2ff);',
      '  color: #000; border: none; border-radius: 8px;',
      '  padding: 8px 18px; font-weight: 700; font-size: 13px;',
      '  cursor: pointer; display: flex; align-items: center; gap: 6px;',
      '  font-family: var(--font-ui, "DM Sans", sans-serif);',
      '  transition: background .15s, transform .1s;',
      '}',
      '#md-download-bar .md-btn:hover { background: #33d1ff; transform: scale(1.03); }',
      '#md-download-bar .md-btn:active { transform: scale(.97); }',
      '#md-download-bar .md-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }',
      '#md-download-bar .md-btn-cancel {',
      '  background: transparent; color: var(--muted, #7a8199);',
      '  border: 1px solid var(--border, #2a2d3e);',
      '  border-radius: 8px; padding: 8px 14px; font-size: 13px;',
      '  cursor: pointer; font-family: var(--font-ui, "DM Sans", sans-serif);',
      '}',
      '#md-download-bar .md-btn-cancel:hover { color: var(--text, #e4e8f0); border-color: var(--muted); }',
      '#md-progress {',
      '  position: fixed; bottom: 120px; left: 50%;',
      '  transform: translateX(-50%);',
      '  background: var(--surface, #1a1d27);',
      '  border: 1px solid var(--border, #2a2d3e);',
      '  border-radius: 12px;',
      '  padding: 16px 24px;',
      '  display: none; flex-direction: column; gap: 8px;',
      '  z-index: 9001; min-width: 320px;',
      '  box-shadow: 0 4px 24px rgba(0,0,0,.4);',
      '  font-family: var(--font-ui, "DM Sans", sans-serif);',
      '  color: var(--text, #e4e8f0);',
      '}',
      '#md-progress .md-prog-label { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#md-progress .md-prog-track { height: 6px; background: var(--border, #2a2d3e); border-radius: 3px; overflow: hidden; }',
      '#md-progress .md-prog-fill { height: 100%; background: var(--accent, #00c2ff); border-radius: 3px; width: 0%; transition: width .3s ease; }',
      '#md-progress .md-prog-detail { font-size: 11px; color: var(--muted, #7a8199); }',
      '#fileTable tbody tr.md-selected { background: rgba(0,194,255,.06) !important; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Download-Leiste (DOM) ──────────────────────────────────
  function createDownloadBar() {
    if (dlBarEl) return;
    dlBarEl = document.createElement('div');
    dlBarEl.id = 'md-download-bar';
    dlBarEl.innerHTML =
      '<span class="md-count"></span>' +
      '<button class="md-btn" id="md-btn-dl">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
          '<polyline points="7 10 12 15 17 10"/>' +
          '<line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg> ' +
        '<span>ZIP herunterladen</span>' +
      '</button>' +
      '<button class="md-btn-cancel" id="md-btn-deselect">Auswahl aufheben</button>';
    document.body.appendChild(dlBarEl);

    document.getElementById('md-btn-dl').addEventListener('click', function () {
      if (!isDownloading) startZipDownload();
    });
    document.getElementById('md-btn-deselect').addEventListener('click', deselectAll);
  }

  // ── Fortschrittsanzeige (DOM) ──────────────────────────────
  function createProgress() {
    if (progressEl) return;
    progressEl = document.createElement('div');
    progressEl.id = 'md-progress';
    progressEl.innerHTML =
      '<div class="md-prog-label">Vorbereitung …</div>' +
      '<div class="md-prog-track"><div class="md-prog-fill"></div></div>' +
      '<div class="md-prog-detail"></div>';
    document.body.appendChild(progressEl);
  }

  function showProgress(label, pct, detail) {
    if (!progressEl) createProgress();
    progressEl.style.display = 'flex';
    progressEl.querySelector('.md-prog-label').textContent = label;
    progressEl.querySelector('.md-prog-fill').style.width  = Math.round(pct) + '%';
    progressEl.querySelector('.md-prog-detail').textContent = detail || '';
  }

  function hideProgress() {
    if (progressEl) progressEl.style.display = 'none';
  }

  // ── Auswahl-Logik ─────────────────────────────────────────
  function getSelectedCount() {
    return Object.keys(selectedFiles).length;
  }

  function updateBar() {
    var count = getSelectedCount();
    if (count > 0 && !isDownloading) {
      dlBarEl.style.display = 'flex';
      dlBarEl.querySelector('.md-count').textContent =
        count + (count === 1 ? ' Datei ausgewählt' : ' Dateien ausgewählt');
    } else if (!isDownloading) {
      dlBarEl.style.display = 'none';
    }
    var headerCb = document.getElementById('md-cb-all');
    if (headerCb) {
      var visibleCount = getVisibleCheckboxes().length;
      headerCb.checked       = visibleCount > 0 && count >= visibleCount;
      headerCb.indeterminate = count > 0 && count < visibleCount;
    }
  }

  function toggleSelect(fileInfo, checked, row) {
    if (checked) {
      selectedFiles[fileInfo.fileId] = fileInfo;
    } else {
      delete selectedFiles[fileInfo.fileId];
    }
    if (row) row.classList.toggle('md-selected', !!checked);
    updateBar();
  }

  function deselectAll() {
    selectedFiles = {};
    var cbs = document.querySelectorAll('.md-row-cb');
    for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
    var rows = document.querySelectorAll('#fileTable tbody tr');
    for (var j = 0; j < rows.length; j++) rows[j].classList.remove('md-selected');
    updateBar();
  }

  // ── Hilfsfunktionen ───────────────────────────────────────

  function getVisibleCheckboxes() {
    var result = [];
    var cbs = document.querySelectorAll('.md-row-cb');
    for (var i = 0; i < cbs.length; i++) {
      var row = cbs[i].closest('tr');
      if (row && row.style.display !== 'none') result.push(cbs[i]);
    }
    return result;
  }

  /**
   * Liest die Datei-Info (fileId + name) aus einer Tabellenzeile.
   * 3 Strategien mit Fallback-Kette:
   */
  function extractFileInfoFromRow(row) {
    var prevBtn = row.querySelector('[id^="prev-btn-"]');
    var idx = -1;

    // 1) prev-btn-{idx} → allFiles[idx]
    if (prevBtn) {
      idx = parseInt(prevBtn.id.replace('prev-btn-', ''), 10);
      if (!isNaN(idx) && window.allFiles && idx >= 0 && idx < window.allFiles.length) {
        var f = window.allFiles[idx];
        if (f) {
          var fileId = (typeof window.getFileId === 'function')
                       ? window.getFileId(f)
                       : (f.versionId || f.id);
          if (fileId) return { fileId: fileId, name: f.name || 'unbenannt' };
        }
      }
    }

    // 2) dl-btn onclick-Attribut parsen
    var dlBtn = row.querySelector('.dl-btn');
    if (dlBtn) {
      var oc = dlBtn.getAttribute('onclick') || '';
      var m = oc.match(/['"]([A-Za-z0-9_-]{10,})['"]/);
      if (m) {
        var nameFromTd = getNameFromFirstTd(row);
        return { fileId: m[1], name: nameFromTd || 'unbenannt' };
      }
    }

    // 3) Name aus der Zeile → in allFiles/baseFiles suchen
    var name = getNameFromFirstTd(row);
    if (name) {
      var arrays = [window.allFiles, window.baseFiles];
      for (var a = 0; a < arrays.length; a++) {
        var arr = arrays[a];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].name === name) {
            var fid = (typeof window.getFileId === 'function')
                      ? window.getFileId(arr[i])
                      : (arr[i].versionId || arr[i].id);
            if (fid) return { fileId: fid, name: name };
          }
        }
      }
    }

    console.warn('[multi-download] Konnte fileId nicht ermitteln. idx=' + idx +
                 ', allFiles.length=' + (window.allFiles ? window.allFiles.length : 'N/A'));
    return null;
  }

  function getNameFromFirstTd(row) {
    // Checkbox-td überspringen: zweite td ist die Name-Spalte
    var tds = row.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      if (tds[i].classList.contains('md-cb-td')) continue;
      var nameEl = tds[i].querySelector('.file-name, a, span');
      var t = nameEl ? nameEl.textContent.trim() : tds[i].textContent.trim();
      if (t && t.length > 1) return t;
    }
    return null;
  }

  // ── Checkboxen in Tabelle injizieren ──────────────────────
  function injectCheckboxes() {
    var table = document.getElementById('fileTable');
    if (!table) return;

    // Header-Checkbox
    var thead = table.querySelector('thead tr');
    if (thead && !thead.querySelector('.md-cb-th')) {
      var th = document.createElement('th');
      th.className = 'md-cb-th';
      th.innerHTML = '<input type="checkbox" id="md-cb-all" title="Alle auswählen / abwählen">';
      thead.insertBefore(th, thead.firstChild);
      document.getElementById('md-cb-all').addEventListener('change', function () {
        var checked = this.checked;
        var visCbs  = getVisibleCheckboxes();
        for (var i = 0; i < visCbs.length; i++) {
          var cb   = visCbs[i];
          var row  = cb.closest('tr');
          var info = cb._mdFileInfo;
          if (info) {
            cb.checked = checked;
            toggleSelect(info, checked, row);
          }
        }
      });
    }

    // Zeilen-Checkboxen
    var rows = table.querySelectorAll('tbody tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.md-cb-td')) continue;

      var fileInfo = extractFileInfoFromRow(row);
      if (!fileInfo) continue;

      var td = document.createElement('td');
      td.className = 'md-cb-td';

      var cb = document.createElement('input');
      cb.type      = 'checkbox';
      cb.className = 'md-row-cb';
      cb._mdFileInfo = fileInfo;
      cb.setAttribute('data-fileid', fileInfo.fileId);

      cb.checked = !!selectedFiles[fileInfo.fileId];
      if (cb.checked) row.classList.add('md-selected');

      cb.addEventListener('change', (function (capturedInfo, capturedRow) {
        return function () { toggleSelect(capturedInfo, this.checked, capturedRow); };
      })(fileInfo, row));

      td.appendChild(cb);
      row.insertBefore(td, row.firstChild);
    }
    updateBar();
  }

  // ── renderTable() hooking ─────────────────────────────────
  function hookRenderTable() {
    if (typeof window.renderTable !== 'function') return;
    if (window._mdRenderHooked) return;
    window._mdRenderHooked = true;

    var origRender = window.renderTable;
    window.renderTable = function () {
      origRender.apply(this, arguments);
      setTimeout(injectCheckboxes, 50);
    };
  }

  // ── ZIP-Download Logik ────────────────────────────────────
  function startZipDownload() {
    var files = [];
    for (var fid in selectedFiles) {
      if (selectedFiles.hasOwnProperty(fid)) {
        files.push(selectedFiles[fid]);
      }
    }
    if (files.length === 0) return;

    isDownloading = true;
    document.getElementById('md-btn-dl').disabled = true;
    console.log('[multi-download] Starte Download:', files.length, 'Dateien', JSON.stringify(files));

    ensureJSZip(function () {
      downloadFilesAsZip(files);
    });
  }

  function downloadFilesAsZip(files) {
    var zip       = new JSZip();
    var total     = files.length;
    var done      = 0;
    var errors    = [];
    var usedNames = {};

    showProgress('Starte Downloads …', 0, '0 / ' + total);

    var chain = Promise.resolve();
    files.forEach(function (entry, i) {
      chain = chain.then(function () {
        var fileId = entry.fileId;
        var name   = entry.name || ('datei_' + i);

        var safeName = name;
        if (usedNames[safeName]) {
          var dot  = safeName.lastIndexOf('.');
          var base = dot > 0 ? safeName.substring(0, dot) : safeName;
          var ext  = dot > 0 ? safeName.substring(dot) : '';
          var n = 2;
          while (usedNames[base + ' (' + n + ')' + ext]) n++;
          safeName = base + ' (' + n + ')' + ext;
        }
        usedNames[safeName] = true;

        showProgress('Lade: ' + name, (done / total) * 100, (done + 1) + ' / ' + total);
        console.log('[multi-download] Lade', (done + 1) + '/' + total, name, 'id=' + fileId);

        return fetchFileBlob(fileId)
          .then(function (blob) {
            zip.file(safeName, blob);
            done++;
            showProgress('Geladen: ' + name, (done / total) * 100, done + ' / ' + total);
          })
          .catch(function (err) {
            done++;
            errors.push(name + ': ' + (err.message || err));
            console.error('[multi-download] Fehler bei', name, err);
            showProgress('Fehler: ' + name, (done / total) * 100, done + ' / ' + total);
          });
      });
    });

    chain.then(function () {
      if (Object.keys(zip.files).length === 0) {
        finishDownload(false, 'Keine Dateien konnten geladen werden.');
        return;
      }
      showProgress('Erstelle ZIP-Archiv …', 100, 'Bitte warten …');
      return zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
        function (meta) {
          showProgress('Erstelle ZIP …', meta.percent, Math.round(meta.percent) + ' %');
        }
      );
    })
    .then(function (blob) {
      if (!blob) return;
      triggerDownload(blob, buildZipName());
      var msg = done + ' Datei(en) heruntergeladen.';
      if (errors.length > 0) msg += ' ' + errors.length + ' Fehler:\n' + errors.join('\n');
      finishDownload(true, msg);
    })
    .catch(function (err) {
      finishDownload(false, 'ZIP-Fehler: ' + (err.message || err));
    });
  }

  function fetchFileBlob(fileId) {
    var token = window.accessToken;
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function (r) {
      if (!r.ok) throw new Error('Download-URL Fehler: HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data.url) throw new Error('Keine Download-URL erhalten');
      return fetch(data.url);
    })
    .then(function (r) {
      if (!r.ok) throw new Error('Download Fehler: HTTP ' + r.status);
      return r.blob();
    });
  }

  function buildZipName() {
    var d   = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return 'SL-Explorer_' + (window.projectId || 'projekt') + '_' + date + '.zip';
  }

  // ── Download auslösen ─────────────────────────────────────
  function triggerDownload(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a   = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      return;
    } catch (e) {
      console.warn('[multi-download] <a download> fehlgeschlagen', e);
    }
    try {
      var url2 = URL.createObjectURL(blob);
      window.open(url2, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url2); }, 60000);
    } catch (e2) {
      console.error('[multi-download] Alle Download-Methoden fehlgeschlagen', e2);
      alert('Download konnte nicht gestartet werden. Bitte Popup-Blocker prüfen.');
    }
  }

  function finishDownload(success, msg) {
    isDownloading = false;
    document.getElementById('md-btn-dl').disabled = false;
    hideProgress();
    if (typeof window.setStatus === 'function') {
      window.setStatus(success ? 'success' : 'danger', msg);
    }
    if (success) deselectAll();
  }

  // ── Initialisierung ───────────────────────────────────────
  function init() {
    injectStyles();
    createDownloadBar();
    createProgress();
    hookRenderTable();
    injectCheckboxes();

    var tbody = document.getElementById('tableBody');
    if (tbody) {
      new MutationObserver(function () {
        setTimeout(injectCheckboxes, 60);
      }).observe(tbody, { childList: true });
    }

    console.log('[multi-download] Modul v1.1 geladen');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
