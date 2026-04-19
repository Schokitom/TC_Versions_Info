/* ============================================================
 *  S+L Explorer — Multi-Download (ZIP)  v1.3
 *  <script src="multi-download.js"></script>
 *  Abhängigkeit: JSZip (wird automatisch geladen)
 * ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var TC_BASE   = 'https://app21.connect.trimble.com';
  var JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  // State: selectedRows = { "prev-btn-idx": true }
  var selectedRows  = {};
  var dlBarEl       = null;
  var progressEl    = null;
  var isDownloading = false;

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
  function getSelectedCount() {
    var n = 0; for (var k in selectedRows) if (selectedRows[k]) n++;
    return n;
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

  /** Gibt die Keys aller sichtbaren Zeilen zurück */
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
  //  Tabelle patchen: Checkboxen IMMER einfügen
  //  Key = prev-btn-Index (wie v1.0), Datei-Info wird erst
  //  beim Download aufgelöst.
  // ══════════════════════════════════════════════════════════

  function patchTable() {
    var table = document.getElementById('fileTable');
    if (!table) return;
    var thead = table.querySelector('thead tr');
    var tbody = table.querySelector('tbody') || document.getElementById('tableBody');
    if (!thead || !tbody) return;

    // Sync-Check: wenn tbody keine Checkboxen hat, thead-CB entfernen
    var firstRow   = tbody.querySelector('tr');
    var tbodyHasCb = firstRow && firstRow.querySelector('.md-cb-td');
    var theadHasCb = thead.querySelector('.md-cb-th');
    if (theadHasCb && !tbodyHasCb && firstRow) {
      theadHasCb.remove();
      theadHasCb = null;
    }

    // Header-Checkbox
    if (!thead.querySelector('.md-cb-th')) {
      var th = document.createElement('th');
      th.className = 'md-cb-th';
      var hcb = document.createElement('input');
      hcb.type = 'checkbox';
      hcb.id = 'md-cb-all';
      hcb.title = 'Alle auswählen / abwählen';
      hcb.addEventListener('change', function () {
        var checked = this.checked;
        var cbs = document.querySelectorAll('.md-row-cb');
        for (var i = 0; i < cbs.length; i++) {
          var r = cbs[i].closest('tr');
          if (r && r.style.display !== 'none') {
            cbs[i].checked = checked;
            toggleRow(cbs[i].getAttribute('data-key'), checked, r);
          }
        }
      });
      th.appendChild(hcb);
      thead.insertBefore(th, thead.firstChild);
    }

    // Zeilen-Checkboxen — IMMER einfügen, für jede Zeile
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.md-cb-td')) continue;

      // Key aus prev-btn ermitteln (oder Laufindex als Fallback)
      var prevBtn = row.querySelector('[id^="prev-btn-"]');
      var key = prevBtn
        ? prevBtn.id.replace('prev-btn-', '')
        : ('row-' + i);

      var td = document.createElement('td');
      td.className = 'md-cb-td';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'md-row-cb';
      cb.setAttribute('data-key', key);
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
      // Vor Render: Header-CB entfernen (wird nach Render neu eingefügt)
      var oldTh = document.querySelector('#fileTable thead .md-cb-th');
      if (oldTh) oldTh.remove();

      origRender.apply(this, arguments);
      setTimeout(patchTable, 30);
    };
  }

  // ══════════════════════════════════════════════════════════
  //  Download: Datei-Info JETZT auflösen (lazy)
  // ══════════════════════════════════════════════════════════

  /**
   * Aus einem prev-btn-Key die fileId + name auflösen.
   * Mehrere Strategien mit Fallback.
   */
  function resolveFileInfo(key) {
    // Strategie 1: Key ist ein numerischer Index → allFiles[idx]
    var idx = parseInt(key, 10);
    if (!isNaN(idx) && window.allFiles) {
      // Durchsuche allFiles — idx könnte direkt passen
      // oder wir müssen alle durchprobieren
      var f = window.allFiles[idx];
      if (f) {
        var fid = (typeof window.getFileId === 'function')
                  ? window.getFileId(f) : (f.versionId || f.id);
        if (fid) return { fileId: fid, name: f.name || 'unbenannt' };
      }
    }

    // Strategie 2: Die zugehörige Tabellenzeile finden und dort
    // den dl-btn oder den Dateinamen auslesen
    var prevBtn = document.getElementById('prev-btn-' + key);
    if (!prevBtn) return null;
    var row = prevBtn.closest('tr');
    if (!row) return null;

    // 2a: dl-btn onclick parsen
    var dlBtn = row.querySelector('.dl-btn');
    if (dlBtn) {
      var oc = dlBtn.getAttribute('onclick') || '';
      // Suche nach einer ID (mind. 10 Zeichen, alphanumerisch + - _)
      var m = oc.match(/['"]([A-Za-z0-9_-]{8,})['"]/);
      if (m) {
        return { fileId: m[1], name: getNameFromRow(row) || 'unbenannt' };
      }
    }

    // 2b: Dateinamen aus der Zeile → in allFiles/baseFiles suchen
    var name = getNameFromRow(row);
    if (name) {
      var arrs = [window.allFiles, window.baseFiles];
      for (var a = 0; a < arrs.length; a++) {
        if (!arrs[a]) continue;
        for (var j = 0; j < arrs[a].length; j++) {
          var ff = arrs[a][j];
          if (ff && ff.name === name) {
            var fid2 = (typeof window.getFileId === 'function')
                       ? window.getFileId(ff) : (ff.versionId || ff.id);
            if (fid2) return { fileId: fid2, name: name };
          }
        }
      }
    }

    return null;
  }

  function getNameFromRow(row) {
    var tds = row.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      if (tds[i].classList.contains('md-cb-td')) continue;
      if (tds[i].classList.contains('actions-td')) continue;
      var el = tds[i].querySelector('.file-name, a, span');
      var t = el ? el.textContent.trim() : tds[i].textContent.trim();
      if (t && t.length > 1) return t;
    }
    return null;
  }

  // ── ZIP-Download ──────────────────────────────────────────
  function startZipDownload() {
    // Alle selektierten Keys → fileInfo auflösen
    var files = [], skipped = [];
    for (var key in selectedRows) {
      if (!selectedRows[key]) continue;
      var info = resolveFileInfo(key);
      if (info) {
        files.push(info);
      } else {
        skipped.push(key);
      }
    }
    if (skipped.length > 0) {
      console.warn('[multi-download] Konnte ' + skipped.length + ' Dateien nicht auflösen:', skipped);
    }
    if (files.length === 0) {
      if (typeof window.setStatus === 'function')
        window.setStatus('danger', 'Keine Dateien konnten identifiziert werden.');
      return;
    }

    isDownloading = true;
    document.getElementById('md-btn-dl').disabled = true;
    console.log('[multi-download] Start:', files.length, 'Dateien', JSON.stringify(files));
    ensureJSZip(function () { downloadFilesAsZip(files); });
  }

  function downloadFilesAsZip(files) {
    var zip = new JSZip(), total = files.length, done = 0, errors = [], usedNames = {};
    showProgress('Starte Downloads …', 0, '0 / ' + total);

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
        return fetchFileBlob(fileId).then(function (blob) {
          zip.file(safeName, blob); done++;
          showProgress('Geladen: ' + name, (done / total) * 100, done + ' / ' + total);
        }).catch(function (err) {
          done++; errors.push(name + ': ' + (err.message || err));
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

  function fetchFileBlob(fileId) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + window.accessToken }
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
    document.getElementById('md-btn-dl').disabled = false;
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
    patchTable();

    var tbody = document.getElementById('tableBody');
    if (tbody) {
      new MutationObserver(function () {
        setTimeout(patchTable, 40);
      }).observe(tbody, { childList: true });
    }
    console.log('[multi-download] Modul v1.3 geladen');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
