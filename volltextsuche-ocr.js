// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Volltextsuche v5 (Thumbnail-OCR)
//  Fix: Event-Handler direkt per addEventListener statt oninput
// ═══════════════════════════════════════════════════════════════
(function(){

  var FTS_CFG = { language: 'deu+eng', maxConcurrent: 3, thumbnailTimeout: 10000 };
  var _ftsIndex = {};
  var _ftsIndexing = false;
  var _ftsAbort = null;
  var _ftsProgress = { done: 0, total: 0, errors: 0 };
  var _tesseractReady = false;

  function _loadTesseract() {
    if (_tesseractReady && window.Tesseract) return Promise.resolve(true);
    return new Promise(function(ok) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = function() { _tesseractReady = true; console.log('[FTS] Tesseract.js geladen'); ok(true); };
      s.onerror = function() { console.error('[FTS] Tesseract.js Fehler'); ok(false); };
      document.head.appendChild(s);
    });
  }

  function _loadThumb(file) {
    var urls = Array.isArray(file.thumbnailUrl) ? file.thumbnailUrl : (file.thumbnailUrl ? [file.thumbnailUrl] : []);
    var url = urls.length > 0 && typeof urls[urls.length - 1] === 'string' ? urls[urls.length - 1] : null;
    if (!url) return Promise.resolve(null);
    var ctrl = new AbortController();
    var tid = setTimeout(function() { ctrl.abort(); }, FTS_CFG.thumbnailTimeout);
    return fetch(url, { headers: { Authorization: 'Bearer ' + accessToken }, signal: ctrl.signal })
      .then(function(r) { clearTimeout(tid); return r.ok ? r.blob() : null; })
      .catch(function() { clearTimeout(tid); return null; });
  }

  function _ocr(blob) {
    if (!window.Tesseract) return Promise.resolve('');
    return Tesseract.recognize(blob, FTS_CFG.language, { logger: function(){} })
      .then(function(r) { return (r && r.data && r.data.text) ? r.data.text.trim() : ''; })
      .catch(function() { return ''; });
  }

  function _indexOne(file) {
    var fid = getFileId(file);
    if (!fid || _ftsIndex[fid]) return Promise.resolve();
    return _loadThumb(file).then(function(blob) {
      if (!blob) { _ftsIndex[fid] = { text: '', name: file.name||'', path: file._path||'/', src: 'name-only' }; return; }
      return _ocr(blob).then(function(txt) {
        _ftsIndex[fid] = { text: txt, name: file.name||'', path: file._path||'/', src: txt ? 'ocr' : 'no-text' };
      });
    });
  }

  function _startIdx() {
    if (_ftsIndexing) return;
    _ftsIndexing = true;
    _loadTesseract().then(function(ok) {
      if (!ok) { _ftsIndexing = false; _uiUpdate('error', 'Tesseract Fehler'); return; }
      var pdfs = baseFiles.filter(function(f) { return f.name && f.name.toLowerCase().indexOf('.pdf') > -1 && f.thumbnailUrl; });
      _ftsProgress = { done: 0, total: pdfs.length, errors: 0 };
      _ftsAbort = { stopped: false };
      _uiUpdate('indexing', 'Indexiere 0/' + pdfs.length + ' PDFs...');
      var i = 0;
      function nextBatch() {
        if (_ftsAbort.stopped || i >= pdfs.length) {
          _ftsIndexing = false;
          var cnt = 0; for (var k in _ftsIndex) { if (_ftsIndex[k].src === 'ocr') cnt++; }
          _uiUpdate('ready', cnt + '/' + pdfs.length + ' PDFs mit Text indexiert');
          console.log('[FTS] Indexierung fertig: ' + cnt + ' OCR');
          return;
        }
        var batch = pdfs.slice(i, i + FTS_CFG.maxConcurrent);
        i += FTS_CFG.maxConcurrent;
        Promise.all(batch.map(function(f) {
          return _indexOne(f).then(function() { _ftsProgress.done++; }).catch(function() { _ftsProgress.done++; _ftsProgress.errors++; });
        })).then(function() {
          _uiUpdate('indexing', 'Indexiere ' + _ftsProgress.done + '/' + pdfs.length + ' PDFs...');
          nextBatch();
        });
      }
      nextBatch();
    });
  }

  function _stopIdx() {
    if (_ftsAbort) _ftsAbort.stopped = true;
    _ftsIndexing = false;
    _uiUpdate('stopped', 'Gestoppt');
  }

  function _search(query) {
    if (!query || query.length < 2) return [];
    var terms = query.toLowerCase().split(/\s+/);
    var out = [];
    for (var fi = 0; fi < baseFiles.length; fi++) {
      var file = baseFiles[fi];
      var fid = getFileId(file);
      if (!fid) continue;
      if (typeof fileMatchesActiveTypes === 'function' && !fileMatchesActiveTypes(file)) continue;
      var entry = _ftsIndex[fid];
      var nm = (file.name || '').toLowerCase();
      var pt = (file._path || '').toLowerCase();
      var ot = entry && entry.text ? entry.text.toLowerCase() : '';
      var score = 0, mt = [], sn = [];
      for (var ti = 0; ti < terms.length; ti++) {
        var t = terms[ti];
        if (t.length < 2) continue;
        if (nm.indexOf(t) >= 0) { score += 10; if (mt.indexOf('name') < 0) mt.push('name'); }
        if (pt.indexOf(t) >= 0) { score += 3; if (mt.indexOf('path') < 0) mt.push('path'); }
        if (ot.indexOf(t) >= 0) {
          score += 5;
          if (mt.indexOf('content') < 0) mt.push('content');
          var ci = ot.indexOf(t);
          var s0 = Math.max(0, ci - 40), s1 = Math.min(ot.length, ci + t.length + 40);
          sn.push((s0 > 0 ? '...' : '') + ot.substring(s0, s1) + (s1 < ot.length ? '...' : ''));
        }
      }
      if (score > 0) out.push({ file: file, fileId: fid, score: score, matchType: mt, snippets: sn.slice(0,2), ocr: !!(entry && entry.src === 'ocr') });
    }
    out.sort(function(a, b) { return b.score - a.score; });
    return out;
  }

  function _render(results, query) {
    var el;
    el = document.getElementById('stateLoading'); if (el) el.style.display = 'none';
    el = document.getElementById('stateError'); if (el) el.style.display = 'none';
    el = document.getElementById('stateEmpty'); if (el) el.style.display = 'none';
    el = document.getElementById('tableWrap'); if (el) el.style.display = 'block';
    el = document.querySelector('.content-split'); if (el) el.style.display = 'flex';

    var tbody = document.getElementById('tableBody');
    if (!tbody) { console.error('[FTS] tableBody fehlt'); return; }
    tbody.innerHTML = '';

    if (results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#7a8199">' +
        'Keine Treffer f\u00fcr "' + escHtml(query) + '"' +
        (_ftsIndexing ? '<br><small>(Indexierung l\u00e4uft noch...)</small>' : '') + '</td></tr>';
      setStatus('ok', '0 Treffer');
      return;
    }

    for (var ri = 0; ri < results.length; ri++) {
      var r = results[ri];
      var f = r.file;
      var name = f.name || '-';
      var modBy = getModifiedBy(f);
      var modAt = formatDate(getModifiedAt(f));
      var ver = f._versionCount || 1;
      var path = f._path || '/';
      var init = modBy.split(/[\s.@]+/).map(function(n){return n[0];}).filter(Boolean).join('').toUpperCase().slice(0,2) || '?';
      var idx = allFiles.indexOf(f);
      if (idx < 0) { allFiles.push(f); idx = allFiles.length - 1; }
      var badges = '';
      var bcolors = { name: '#00c2ff', path: '#7a8199', content: '#22d3a0' };
      var blabels = { name: 'Name', path: 'Pfad', content: 'Inhalt' };
      for (var bi = 0; bi < r.matchType.length; bi++) {
        var bt = r.matchType[bi];
        badges += '<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:8px;background:' + bcolors[bt] + ';color:#000;font-weight:600;margin-left:4px">' + blabels[bt] + '</span>';
      }
      var snipHtml = '';
      if (r.snippets.length > 0) {
        var hl = '';
        for (var si = 0; si < r.snippets.length; si++) {
          var sh = escHtml(r.snippets[si]);
          var qw = query.toLowerCase().split(/\s+/);
          for (var qi = 0; qi < qw.length; qi++) {
            if (qw[qi].length >= 2) {
              sh = sh.replace(new RegExp('(' + qw[qi].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
                '<mark style="background:#f59e0b;color:#000;padding:0 2px;border-radius:2px">$1</mark>');
            }
          }
          hl += (hl ? ' ... ' : '') + sh;
        }
        snipHtml = '<div style="font-size:10px;color:#7a8199;margin-top:3px;font-style:italic;max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + hl + '</div>';
      }
      var tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #2a2d3e';
      tr.innerHTML =
        '<td style="padding:10px 12px"><div style="display:flex;flex-direction:column;gap:2px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            getFileIconHtml(name) +
            '<span onclick="openFile(' + idx + ')" style="color:#00c2ff;font-family:var(--font);font-size:12.5px;font-weight:500;cursor:pointer">' + escHtml(name) + '</span>' +
            badges +
          '</div>' + snipHtml +
        '</div></td>' +
        '<td style="padding:10px 12px"><div class="user-chip"><div class="avatar">' + escHtml(init) + '</div><span>' + escHtml(modBy) + '</span></div></td>' +
        '<td style="padding:10px 12px;font-family:var(--font);font-size:11px;color:#7a8199;white-space:nowrap">' + modAt + '</td>' +
        '<td style="padding:10px 12px;text-align:center"><span class="version-badge" onclick="openVersionModal(' + idx + ',\'' + escHtml(name).replace(/'/g, "\\'") + '\')">' + ver + '</span></td>' +
        '<td style="padding:10px 12px;font-family:var(--font);font-size:11px;color:#7a8199">' + escHtml(path) + '</td>' +
        '<td class="actions-td" style="text-align:center;padding:10px 12px"><div style="display:inline-flex;gap:4px">' +
          '<button class="prev-btn" id="prev-btn-' + idx + '" onclick="openPreview(' + idx + ')" title="Vorschau"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>' +
          '<button class="dl-btn" onclick="downloadFile(' + idx + ')" title="Download"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg></button>' +
        '</div></td>';
      tbody.appendChild(tr);
    }
    setStatus('ok', results.length + ' Volltexttreffer');
  }

  function _uiUpdate(state, msg) {
    var pill = document.getElementById('ftsPill');
    var st = document.getElementById('ftsStatus');
    if (!pill || !st) return;
    pill.style.display = 'inline-block';
    st.textContent = msg || '';
    st.style.color = state === 'indexing' ? '#f59e0b' : state === 'ready' ? '#22d3a0' : state === 'error' || state === 'stopped' ? '#ef4444' : '#7a8199';
  }

  function _initUI() {
    var tb = document.getElementById('toolbar');
    if (!tb) return;
    var lbl = document.createElement('label');
    lbl.className = 'scope-toggle';
    lbl.title = 'Volltextsuche via Thumbnail-OCR';
    lbl.innerHTML = '<input type="checkbox" id="ftsCheck" /><span>Volltext (OCR)</span>';
    var pill = document.createElement('div');
    pill.className = 'stat-pill';
    pill.id = 'ftsPill';
    pill.style.display = 'none';
    pill.innerHTML = '<span id="ftsStatus">-</span>';
    var scope = tb.querySelector('.scope-toggle');
    if (scope && scope.parentNode) {
      scope.parentNode.insertBefore(lbl, scope.nextSibling);
      scope.parentNode.insertBefore(pill, lbl.nextSibling);
    }
    var cb = document.getElementById('ftsCheck');
    if (cb) {
      cb.addEventListener('change', function() {
        if (cb.checked) { _startIdx(); } else { _stopIdx(); pill.style.display = 'none'; _doFilter(); }
      });
    }

    // ═══════════════════════════════════════════════════════════
    //  FIX v5: Eigener Input-Handler auf dem Suchfeld
    //  Ersetzt den oninput="filterTable()" Attribut-Handler
    //  mit einem addEventListener der GARANTIERT im richtigen
    //  Scope (diesem iframe) läuft.
    // ═══════════════════════════════════════════════════════════
    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
      // Entferne den alten oninput Handler
      searchInput.removeAttribute('oninput');
      // Setze neuen Handler
      searchInput.addEventListener('input', function() {
        _doFilter();
      });
    }

    // Ebenso den searchScopeCheck
    var scopeCheck = document.getElementById('searchScopeCheck');
    if (scopeCheck) {
      scopeCheck.removeAttribute('onchange');
      scopeCheck.addEventListener('change', function() {
        _doFilter();
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Zentrale Filter-Funktion — wird bei JEDER Eingabe aufgerufen
  // ═══════════════════════════════════════════════════════════
  function _doFilter() {
    var cb = document.getElementById('ftsCheck');
    var ftsOn = cb && cb.checked;
    var inp = document.getElementById('searchInput');
    var query = inp ? inp.value.trim() : '';
    var scopeCheck = document.getElementById('searchScopeCheck');
    var searchAll = scopeCheck && scopeCheck.checked;

    if (ftsOn && query.length >= 2) {
      var results = _search(query);
      console.log('[FTS] Suche nach "' + query + '": ' + results.length + ' Treffer');
      _render(results, query);
      return;
    }

    // FTS aktiv aber zu kurzer Query → normale Tabelle
    if (ftsOn && query.length < 2) {
      // Rufe die Original-Render-Logik auf
      searchResultFiles = null;
      allFiles = baseFiles.slice();
      if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
        searchAllAbortController.abort();
        searchAllAbortController = null;
      }
      renderTable();
      return;
    }

    // FTS nicht aktiv → Original filterTable Logik
    if (searchAll && query) {
      if (typeof searchEntireProject === 'function') searchEntireProject(query);
    } else {
      searchResultFiles = null;
      allFiles = baseFiles.slice();
      if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
        searchAllAbortController.abort();
        searchAllAbortController = null;
      }
      renderTable();
    }
  }

  // Auch filterTable überschreiben (für Aufrufe aus anderem Code)
  var _origFilter = window.filterTable;
  window.filterTable = _doFilter;

  // Globale Referenzen
  window.fulltextSearch = _search;
  window.renderFtsResults = _render;
  window.ftsIndex = _ftsIndex;

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initUI);
  } else {
    setTimeout(_initUI, 500);
  }

  console.log('[FTS] Volltextsuche v5 geladen');

})();
