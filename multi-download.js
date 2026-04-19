/* ============================================================
 *  S+L Explorer — Multi-Download (ZIP)  v1.5
 *  <script src="multi-download.js"></script>
 *  Abhängigkeit: JSZip (wird automatisch geladen)
 *
 *  Kernproblem gelöst: allFiles / getFileId leben im Closure
 *  der index.html. downloadFile(idx) ist aber global.
 *  → Wir parsen den idx aus onclick="downloadFile(N)" und
 *    nutzen eine Bridge um allFiles[idx] zu erreichen.
 * ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE   = 'https://app21.connect.trimble.com';
  var JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  var selectedRows  = {};   // { key: { fileId, name } }
  var dlBarEl       = null;
  var progressEl    = null;
  var isDownloading = false;

  // ══════════════════════════════════════════════════════════
  //  Bridge: allFiles + getFileId aus dem Closure exponieren
  //  Wir wrappen downloadFile() — die ist global — um bei
  //  jedem Aufruf die Datei-Daten auf window zu cachen.
  // ══════════════════════════════════════════════════════════

  function installBridge() {
    if (window._mdBridgeInstalled) return;

    // downloadFile(idx) ist global. Wir wrappen sie.
    if (typeof window.downloadFile === 'function') {
      var origDownloadFile = window.downloadFile;
      window.downloadFile = function (idx) {
        // Die Bridge: allFiles und getFileId müssen im selben
        // Scope sein wie downloadFile. Wir testen ob sie
        // über den Aufruf-Kontext erreichbar sind.
        // Aber wir können sie nicht direkt greifen — sie sind
        // im Closure. Stattdessen nutzen wir einen anderen Trick.
        return origDownloadFile.apply(this, arguments);
      };
    }

    // Alternativer Ansatz: Wir injizieren ein Script-Tag
    // das im selben Scope wie der inline-Code läuft
    var script = document.createElement('script');
    script.textContent =
      '(function() {' +
      '  if (typeof allFiles !== "undefined") {' +
      '    window._mdAllFiles = allFiles;' +
      '    console.log("[multi-download] Bridge: allFiles exponiert (" + allFiles.length + " Dateien)");' +
      '  }' +
      '  if (typeof getFileId === "function") {' +
      '    window._mdGetFileId = getFileId;' +
      '    console.log("[multi-download] Bridge: getFileId exponiert");' +
      '  }' +
      '  if (typeof accessToken !== "undefined") {' +
      '    window._mdAccessToken = accessToken;' +
      '  }' +
      '})();';
    document.body.appendChild(script);
    // Script-Tag aufräumen (wurde schon ausgeführt)
    script.remove();

    window._mdBridgeInstalled = true;
  }

  /**
   * fileId aus dem Index ermitteln via Bridge
   */
  function getFileInfoByIndex(idx) {
    var files = window._mdAllFiles;
    var getFid = window._mdGetFileId;

    if (!files || idx < 0 || idx >= files.length) return null;
    var f = files[idx];
    if (!f) return null;

    var fileId = (typeof getFid === 'function') ? getFid(f) : (f.versionId || f.id);
    return { fileId: fileId, name: f.name || 'unbenannt' };
  }

  // ── JSZip ──────────────────────────────────────────────────
  function ensureJSZip(cb) {
    if (window.JSZip) return cb();
    var s = document.createElement('script');
    s.src = JSZIP_CDN;
    s.onload  = function () { cb(); };
    s.onerror = function () { alert('JSZip konnte nicht geladen werden.'); };
    document.head.appendChild(s);
  }

  // ── CSS ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('md-styles')) return;
    var style = document.createElement('style');
    style.id = 'md-styles';
    style.textContent =
      '.md-cb-th,.md-cb-td{width:36px!important;min-width:36px!important;max-width:36px!important;text-align:center!important;vertical-align:middle!important;padding:4px 6px!important;box-sizing:border-box!important}' +
      '.md-cb-th input,.md-cb-td input{width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#00c2ff)}' +
      '#md-download-bar{position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:var(--surface,#1a1d27);border:1px solid var(--accent,#00c2ff);border-radius:12px;padding:10px 20px;display:none;align-items:center;gap:14px;z-index:9000;box-shadow:0 4px 24px rgba(0,194,255,.25);font-family:var(--font-ui,"DM Sans",sans-serif);color:var(--text,#e4e8f0);animation:md-slide-up .25s ease-out}' +
      '@keyframes md-slide-up{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}' +
      '#md-download-bar .md-count{font-weight:600;font-size:14px;white-space:nowrap}' +
      '#md-download-bar .md-btn{background:var(--accent,#00c2ff);color:#000;border:none;border-radius:8px;padding:8px 18px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:var(--font-ui,"DM Sans",sans-serif);transition:background .15s,transform .1s}' +
      '#md-download-bar .md-btn:hover{background:#33d1ff;transform:scale(1.03)}#md-download-bar .md-btn:active{transform:scale(.97)}#md-download-bar .md-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}' +
      '#md-download-bar .md-btn-cancel{background:transparent;color:var(--muted,#7a8199);border:1px solid var(--border,#2a2d3e);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:var(--font-ui,"DM Sans",sans-serif)}' +
      '#md-download-bar .md-btn-cancel:hover{color:var(--text,#e4e8f0);border-color:var(--muted)}' +
      '#md-progress{position:fixed;bottom:120px;left:50%;transform:translateX(-50%);background:var(--surface,#1a1d27);border:1px solid var(--border,#2a2d3e);border-radius:12px;padding:16px 24px;display:none;flex-direction:column;gap:8px;z-index:9001;min-width:320px;box-shadow:0 4px 24px rgba(0,0,0,.4);font-family:var(--font-ui,"DM Sans",sans-serif);color:var(--text,#e4e8f0)}' +
      '#md-progress .md-prog-label{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#md-progress .md-prog-track{height:6px;background:var(--border,#2a2d3e);border-radius:3px;overflow:hidden}' +
      '#md-progress .md-prog-fill{height:100%;background:var(--accent,#00c2ff);border-radius:3px;width:0%;transition:width .3s ease}' +
      '#md-progress .md-prog-detail{font-size:11px;color:var(--muted,#7a8199)}' +
      '#fileTable tbody tr.md-selected{background:rgba(0,194,255,.06)!important}';
    document.head.appendChild(style);
  }

  // ── Download-Leiste ────────────────────────────────────────
  function createDownloadBar() {
    if (dlBarEl) return;
    dlBarEl = document.createElement('div');
    dlBarEl.id = 'md-download-bar';
    dlBarEl.innerHTML =
      '<span class="md-count"></span>' +
      '<button class="md-btn" id="md-btn-dl">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
          '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg><span>ZIP herunterladen</span>' +
      '</button>' +
      '<button class="md-btn-cancel" id="md-btn-deselect">Auswahl aufheben</button>';
    document.body.appendChild(dlBarEl);
    document.getElementById('md-btn-dl').addEventListener('click', function () {
      if (!isDownloading) startZipDownload();
    });
    document.getElementById('md-btn-deselect').addEventListener('click', deselectAll);
  }

  // ── Fortschritt ────────────────────────────────────────────
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
  function hideProgress() { if (progressEl) progressEl.style.display = 'none'; }

  // ── Auswahl ────────────────────────────────────────────────
  function getSelectedCount() { return Object.keys(selectedRows).length; }

  function updateBar() {
    var count = getSelectedCount();
    if (count > 0 && !isDownloading) {
      dlBarEl.style.display = 'flex';
      dlBarEl.querySelector('.md-count').textContent =
        count + (count === 1 ? ' Datei ausgewählt' : ' Dateien ausgewählt');
    } else if (!isDownloading) {
      dlBarEl.style.display = 'none';
    }
    var hcb = document.getElementById('md-cb-all');
    if (hcb) {
      var vis = getVisibleRowKeys().length;
      hcb.checked       = vis > 0 && count >= vis;
      hcb.indeterminate = count > 0 && count < vis;
    }
  }

  function toggleRow(key, checked, row) {
    if (checked) selectedRows[key] = true;
    else delete selectedRows[key];
    if (row) row.classList.toggle('md-selected', !!checked);
    updateBar();
  }

  function deselectAll() {
    selectedRows = {};
    var cbs = document.querySelectorAll('.md-row-cb');
    for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
    var rows = document.querySelectorAll('#fileTable tbody tr');
    for (var j = 0; j < rows.length; j++) rows[j].classList.remove('md-selected');
    updateBar();
  }

  function getVisibleRowKeys() {
    var result = [];
    var cbs = document.querySelectorAll('.md-row-cb');
    for (var i = 0; i < cbs.length; i++) {
      var row = cbs[i].closest('tr');
      if (row && row.style.display !== 'none') {
        var key = cbs[i].getAttribute('data-key');
        if (key) result.push(key);
      }
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════
  //  Index aus onclick="downloadFile(N)" parsen
  // ══════════════════════════════════════════════════════════

  function getIndexFromRow(row) {
    // Primär: dl-btn onclick="downloadFile(N)"
    var dlBtn = row.querySelector('.dl-btn');
    if (dlBtn) {
      var oc = dlBtn.getAttribute('onclick') || '';
      var m = oc.match(/downloadFile\s*\(\s*(\d+)\s*\)/);
      if (m) return parseInt(m[1], 10);
    }
    // Fallback: prev-btn onclick="openPreview(N)"
    var prevBtn = row.querySelector('.prev-btn, [id^="prev-btn-"]');
    if (prevBtn) {
      var oc2 = prevBtn.getAttribute('onclick') || '';
      var m2 = oc2.match(/openPreview\s*\(\s*(\d+)\s*\)/);
      if (m2) return parseInt(m2[1], 10);
      // Oder aus der ID
      var idMatch = (prevBtn.id || '').match(/prev-btn-(\d+)/);
      if (idMatch) return parseInt(idMatch[1], 10);
    }
    return -1;
  }

  // ══════════════════════════════════════════════════════════
  //  Tabelle patchen
  // ══════════════════════════════════════════════════════════

  function patchTable() {
    var table = document.getElementById('fileTable');
    if (!table) return;
    var thead = table.querySelector('thead tr');
    var tbody = table.querySelector('tbody') || document.getElementById('tableBody');
    if (!thead || !tbody) return;

    // Bridge bei jedem Patch auffrischen (allFiles kann sich ändern)
    installBridge();

    // Sync
    var firstRow = tbody.querySelector('tr');
    var tbodyHasCb = firstRow && firstRow.querySelector('.md-cb-td');
    var theadHasCb = thead.querySelector('.md-cb-th');
    if (theadHasCb && !tbodyHasCb && firstRow) theadHasCb.remove();

    // Header-Checkbox
    if (!thead.querySelector('.md-cb-th')) {
      var th = document.createElement('th');
      th.className = 'md-cb-th';
      var hcb = document.createElement('input');
      hcb.type = 'checkbox'; hcb.id = 'md-cb-all';
      hcb.title = 'Alle auswählen / abwählen';
      hcb.addEventListener('change', function () {
        var checked = this.checked;
        var cbs = document.querySelectorAll('.md-row-cb');
        for (var i = 0; i < cbs.length; i++) {
          var r = cbs[i].closest('tr');
          if (r && r.style.display !== 'none' && !cbs[i].disabled) {
            cbs[i].checked = checked;
            toggleRow(cbs[i].getAttribute('data-key'), checked, r);
          }
        }
      });
      th.appendChild(hcb);
      thead.insertBefore(th, thead.firstChild);
    }

    // Zeilen-Checkboxen
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.md-cb-td')) continue;

      var idx = getIndexFromRow(row);
      var key = idx >= 0 ? String(idx) : ('row-' + i);

      var td = document.createElement('td');
      td.className = 'md-cb-td';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'md-row-cb';
      cb.setAttribute('data-key', key);
      cb.setAttribute('data-idx', idx);
      cb.checked = !!selectedRows[key];
      if (cb.checked) row.classList.add('md-selected');

      cb.addEventListener('change', (function (k, r) {
        return function () { toggleRow(k, this.checked, r); };
      })(key, row));

      td.appendChild(cb);
      row.insertBefore(td, row.firstChild);
    }
    updateBar();
  }

  // ── renderTable() Hook ────────────────────────────────────
  function hookRenderTable() {
    if (typeof window.renderTable !== 'function') return;
    if (window._mdRenderHooked) return;
    window._mdRenderHooked = true;
    var origRender = window.renderTable;
    window.renderTable = function () {
      var oldTh = document.querySelector('#fileTable thead .md-cb-th');
      if (oldTh) oldTh.remove();
      origRender.apply(this, arguments);
      setTimeout(function () {
        // Bridge auffrischen nach Render (allFiles könnte sich geändert haben)
        installBridge();
        patchTable();
      }, 30);
    };
  }

  // ── ZIP-Download ──────────────────────────────────────────
  function startZipDownload() {
    // Bridge nochmal auffrischen um aktuelle Daten zu haben
    installBridge();

    var files = [], skipped = [];
    for (var key in selectedRows) {
      if (!selectedRows[key]) continue;
      var idx = parseInt(key, 10);
      if (isNaN(idx) || idx < 0) { skipped.push(key); continue; }

      var info = getFileInfoByIndex(idx);
      if (info) {
        files.push(info);
      } else {
        skipped.push(key + ' (idx=' + idx + ')');
      }
    }

    if (skipped.length > 0) {
      console.warn('[multi-download] Nicht aufgelöst:', skipped);
    }
    if (files.length === 0) {
      if (typeof window.setStatus === 'function')
        window.setStatus('danger', 'Keine Dateien konnten identifiziert werden. Bridge: ' +
          (window._mdAllFiles ? window._mdAllFiles.length + ' Dateien' : 'NICHT VERFÜGBAR'));
      finishDownload(false, 'Keine Dateien identifiziert.');
      return;
    }

    isDownloading = true;
    document.getElementById('md-btn-dl').disabled = true;
    console.log('[multi-download] Start:', files.length, 'Dateien',
      files.map(function(f) { return f.name + ' (' + f.fileId + ')'; }));
    ensureJSZip(function () { downloadFilesAsZip(files); });
  }

  function downloadFilesAsZip(files) {
    var zip = new JSZip(), total = files.length, done = 0, errors = [], usedNames = {};
    showProgress('Starte Downloads …', 0, '0 / ' + total);

    // Token: entweder aus Bridge oder von window
    var token = window._mdAccessToken || window.accessToken;

    var chain = Promise.resolve();
    files.forEach(function (entry, i) {
      chain = chain.then(function () {
        var fileId = entry.fileId, name = entry.name || ('datei_' + i);
        var safeName = name;
        if (usedNames[safeName]) {
          var dot = safeName.lastIndexOf('.'), base = dot > 0 ? safeName.substring(0, dot) : safeName;
          var ext = dot > 0 ? safeName.substring(dot) : '', n = 2;
          while (usedNames[base + ' (' + n + ')' + ext]) n++;
          safeName = base + ' (' + n + ')' + ext;
        }
        usedNames[safeName] = true;
        showProgress('Lade: ' + name, (done / total) * 100, (done + 1) + ' / ' + total);
        return fetchFileBlob(fileId, token).then(function (blob) {
          zip.file(safeName, blob); done++;
          showProgress('Geladen: ' + name, (done / total) * 100, done + ' / ' + total);
        }).catch(function (err) {
          done++; errors.push(name + ': ' + (err.message || err));
          console.error('[multi-download] Fehler:', name, err);
          showProgress('Fehler: ' + name, (done / total) * 100, done + ' / ' + total);
        });
      });
    });

    chain.then(function () {
      if (Object.keys(zip.files).length === 0) { finishDownload(false, 'Keine Dateien geladen.'); return; }
      showProgress('Erstelle ZIP …', 100, 'Bitte warten …');
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
        function (m) { showProgress('Erstelle ZIP …', m.percent, Math.round(m.percent) + ' %'); });
    }).then(function (blob) {
      if (!blob) return;
      triggerDownload(blob, buildZipName());
      var msg = done + ' Datei(en) heruntergeladen.';
      if (errors.length) msg += ' ' + errors.length + ' Fehler:\n' + errors.join('\n');
      finishDownload(true, msg);
    }).catch(function (err) { finishDownload(false, 'ZIP-Fehler: ' + (err.message || err)); });
  }

  function fetchFileBlob(fileId, token) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d.url) throw new Error('Keine URL');
      return fetch(d.url);
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    });
  }

  function buildZipName() {
    var d = new Date(), p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return 'SL-Explorer_' + (window.projectId || 'projekt') + '_' +
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.zip';
  }

  function triggerDownload(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      return;
    } catch (e) { console.warn('[multi-download] <a> failed', e); }
    try { window.open(URL.createObjectURL(blob), '_blank'); }
    catch (e2) { alert('Download konnte nicht gestartet werden.'); }
  }

  function finishDownload(ok, msg) {
    isDownloading = false;
    var btn = document.getElementById('md-btn-dl');
    if (btn) btn.disabled = false;
    hideProgress();
    if (typeof window.setStatus === 'function') window.setStatus(ok ? 'success' : 'danger', msg);
    if (ok) deselectAll();
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    injectStyles();
    createDownloadBar();
    createProgress();
    hookRenderTable();

    // Bridge installieren — muss nach dem index.html Code laufen,
    // also mit kurzer Verzögerung
    setTimeout(function () {
      installBridge();
      patchTable();
    }, 200);

    var tbody = document.getElementById('tableBody');
    if (tbody) {
      new MutationObserver(function () {
        setTimeout(function () {
          installBridge();
          patchTable();
        }, 40);
      }).observe(tbody, { childList: true });
    }
    console.log('[multi-download] Modul v1.5 geladen');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
