/* ============================================================
 *  S+L Explorer — Multi-Download (ZIP)  v1.4
 *  <script src="multi-download.js"></script>
 *  Abhängigkeit: JSZip (wird automatisch geladen)
 *
 *  WICHTIG: allFiles / getFileId sind NICHT auf window verfügbar
 *  (Closure-Scope in index.html). Datei-Infos werden daher
 *  komplett aus dem DOM extrahiert.
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

  function toggleRow(key, fileInfo, checked, row) {
    if (checked) selectedRows[key] = fileInfo;
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
  //  DOM-basierte Datei-Info Extraktion
  //  allFiles ist NICHT auf window → alles aus dem DOM holen
  // ══════════════════════════════════════════════════════════

  /**
   * Extrahiert fileId und Dateiname aus einer Tabellenzeile.
   * Durchsucht alle Buttons (dl-btn, prev-btn) nach onclick-Attributen
   * die eine File-ID enthalten.
   */
  function extractFileInfoFromRow(row) {
    var name = getNameFromRow(row);

    // Strategie: Alle Buttons/Links in der Zeile nach onclick durchsuchen
    var buttons = row.querySelectorAll('button, a');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var oc = btn.getAttribute('onclick') || '';
      if (!oc) continue;

      // Suche alle String-Argumente im onclick
      // Pattern: Funktion('arg1', 'arg2', ...) oder Funktion("arg1", ...)
      var allStrings = [];
      var re = /['"]([^'"]+)['"]/g;
      var match;
      while ((match = re.exec(oc)) !== null) {
        allStrings.push(match[1]);
      }

      // Die fileId ist typischerweise ein alphanumerischer String mit
      // Bindestrichen/Unterstrichen, 8-30 Zeichen lang (z.B. "M2F87bPwc3w")
      for (var j = 0; j < allStrings.length; j++) {
        var candidate = allStrings[j];
        if (/^[A-Za-z0-9_-]{8,30}$/.test(candidate)) {
          // Prüfen ob es nicht ein Dateiname ist (hat Punkt + Extension)
          if (candidate.indexOf('.') === -1) {
            return { fileId: candidate, name: name || 'unbenannt' };
          }
        }
      }
    }

    // Strategie 2: data-Attribute auf Buttons
    for (var k = 0; k < buttons.length; k++) {
      var fid = buttons[k].getAttribute('data-fileid') ||
                buttons[k].getAttribute('data-id') ||
                buttons[k].getAttribute('data-version-id');
      if (fid) return { fileId: fid, name: name || 'unbenannt' };
    }

    // Strategie 3: Links mit fileId in der URL
    var links = row.querySelectorAll('a[href]');
    for (var l = 0; l < links.length; l++) {
      var href = links[l].getAttribute('href') || '';
      var hMatch = href.match(/\/files?\/([A-Za-z0-9_-]{8,30})/);
      if (hMatch) return { fileId: hMatch[1], name: name || 'unbenannt' };
    }

    console.warn('[multi-download] Keine fileId in Zeile gefunden. Buttons:', 
      Array.from(buttons).map(function(b) { 
        return { tag: b.tagName, onclick: b.getAttribute('onclick'), id: b.id, cls: b.className }; 
      })
    );
    return null;
  }

  function getNameFromRow(row) {
    var tds = row.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      if (tds[i].classList.contains('md-cb-td')) continue;
      if (tds[i].classList.contains('actions-td')) continue;
      // Erste nicht-Checkbox, nicht-Actions Zelle = Dateiname
      var el = tds[i].querySelector('.file-name, a, span');
      var t = el ? el.textContent.trim() : '';
      // Prüfen ob es wie ein Dateiname aussieht (hat Punkt + Extension)
      if (t && /\.\w{2,5}$/.test(t)) return t;
      // Oder einfach nicht-leerer Text
      if (t && t.length > 1) return t;
    }
    return null;
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

    // Sync: wenn tbody keine CBs hat, thead-CB auch entfernen
    var firstRow = tbody.querySelector('tr');
    var tbodyHasCb = firstRow && firstRow.querySelector('.md-cb-td');
    var theadHasCb = thead.querySelector('.md-cb-th');
    if (theadHasCb && !tbodyHasCb && firstRow) {
      theadHasCb.remove();
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
            var key = cbs[i].getAttribute('data-key');
            var info = cbs[i]._mdFileInfo;
            if (key && info) toggleRow(key, info, checked, r);
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

      var prevBtn = row.querySelector('[id^="prev-btn-"]');
      var key = prevBtn ? prevBtn.id.replace('prev-btn-', '') : ('row-' + i);

      // Datei-Info aus dem DOM extrahieren
      var fileInfo = extractFileInfoFromRow(row);

      var td = document.createElement('td');
      td.className = 'md-cb-td';

      // Checkbox immer einfügen (Spaltenausrichtung),
      // aber nur klickbar wenn fileInfo vorhanden
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'md-row-cb';
      cb.setAttribute('data-key', key);

      if (fileInfo) {
        cb._mdFileInfo = fileInfo;
        cb.checked = !!selectedRows[key];
        if (cb.checked) row.classList.add('md-selected');
        cb.addEventListener('change', (function (k, info, r) {
          return function () { toggleRow(k, info, this.checked, r); };
        })(key, fileInfo, row));
      } else {
        // Kein fileInfo → Checkbox deaktivieren
        cb.disabled = true;
        cb.title = 'Datei konnte nicht identifiziert werden';
      }

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
      setTimeout(patchTable, 30);
    };
  }

  // ── ZIP-Download ──────────────────────────────────────────
  function startZipDownload() {
    var files = [];
    for (var key in selectedRows) {
      if (selectedRows.hasOwnProperty(key) && selectedRows[key]) {
        files.push(selectedRows[key]);
      }
    }
    if (files.length === 0) {
      if (typeof window.setStatus === 'function')
        window.setStatus('danger', 'Keine Dateien ausgewählt.');
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
    console.log('[multi-download] Modul v1.4 geladen');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
