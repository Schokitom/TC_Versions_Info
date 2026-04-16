// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Volltextsuche v7 (PDF.js + Download-Endpoint)
//  FIX: Korrigiertes PSet-Schema (ohne 'v' Feld, mit proper types)
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var PSET_REGION = 'eu-west-1';
  var DEF_ID = 'sl-pdf-fulltext';
  var DEF_NAME = 'S+L PDF Volltext-Cache';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

  // ═══ KORRIGIERTES SCHEMA ═══
  // Format laut tcfiles-Beispiel: properties direkt im schema, ohne 'v' Feld
  var SCHEMA = {
    open: true,
    props: {
      'fulltext':     { type: 'string' },
      'page_count':   { type: 'integer' },
      'extracted_at': { type: 'string', format: 'date-time' },
    }
  };

  var _ftsIndex = {};
  var _indexing = false;
  var _abort = null;
  var _progress = { done: 0, total: 0, cached: 0, extracted: 0, errors: 0 };
  var _libId = null;
  var _defExists = false;
  var _pdfjsLib = null;

  function loadPdfJs() {
    if (_pdfjsLib) return Promise.resolve(_pdfjsLib);
    return import(PDFJS_URL).then(function(lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      _pdfjsLib = lib;
      console.log('[FTS] PDF.js geladen');
      return lib;
    }).catch(function(e) {
      console.error('[FTS] PDF.js Load-Fehler:', e);
      return null;
    });
  }

  function psetFetch(path, method, body) {
    var opts = {
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(PROXY_URL + '/pset/' + PSET_REGION + path, opts).then(function(r) {
      return r.text().then(function(t) {
        var data = null;
        try { data = JSON.parse(t); } catch(e) { data = t; }
        return { status: r.status, ok: r.ok, data: data };
      });
    });
  }

  function ensureDefinition() {
    _libId = 'tcproject:prod:' + projectId;
    return psetFetch('/libs/' + _libId + '/defs/' + DEF_ID, 'GET').then(function(r) {
      if (r.ok) {
        _defExists = true;
        console.log('[FTS] Definition existiert bereits');
        return true;
      }
      console.log('[FTS] Erstelle Volltext-Cache Definition...');
      var body = {
        id: DEF_ID,
        name: DEF_NAME,
        schema: SCHEMA,
      };
      return psetFetch('/libs/' + _libId + '/defs', 'POST', body).then(function(r2) {
        if (r2.ok || r2.status === 201) {
          _defExists = true;
          console.log('[FTS] Definition erstellt!');
          return true;
        }
        console.error('[FTS] Def-Fehler:', r2.status, JSON.stringify(r2.data));
        return false;
      });
    });
  }

  function readCache(fileId) {
    var link = 'frn:tcfile:' + fileId;
    return psetFetch(
      '/psets/' + encodeURIComponent(link) + '/' + encodeURIComponent(_libId) + '/' + DEF_ID,
      'GET'
    ).then(function(r) {
      return (r.ok && r.data && r.data.props) ? r.data.props : null;
    }).catch(function() { return null; });
  }

  function writeCache(fileId, data) {
    var link = 'frn:tcfile:' + fileId;
    return psetFetch(
      '/psets/' + encodeURIComponent(link) + '/' + encodeURIComponent(_libId) + '/' + DEF_ID,
      'PUT',
      { props: data }
    ).then(function(r) {
      return r.ok || r.status === 200 || r.status === 201 || r.status === 409;
    }).catch(function() { return false; });
  }

  function getDownloadUrl(fileId) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }).then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(data) {
      return data ? data.url : null;
    }).catch(function() { return null; });
  }

  function extractPdfText(fileId) {
    return getDownloadUrl(fileId).then(function(dlUrl) {
      if (!dlUrl) throw new Error('Keine Download-URL');
      return fetch(dlUrl);
    }).then(function(r) {
      if (!r.ok) throw new Error('PDF Download Fehler: ' + r.status);
      return r.arrayBuffer();
    }).then(function(buf) {
      return _pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function(pdf) {
      var pageCount = pdf.numPages;
      var pagePromises = [];
      for (var i = 1; i <= pageCount; i++) {
        pagePromises.push(pdf.getPage(i).then(function(page) {
          return page.getTextContent().then(function(content) {
            return content.items.map(function(item) { return item.str; }).join(' ');
          });
        }));
      }
      return Promise.all(pagePromises).then(function(pageTexts) {
        return {
          text: pageTexts.join('\n\n'),
          pages: pageCount,
        };
      });
    });
  }

  function indexOne(file) {
    var fileId = getFileId(file);
    if (!fileId) return Promise.resolve({ src: 'skip' });

    return readCache(fileId).then(function(cached) {
      if (cached && cached.fulltext && cached.fulltext.length > 0) {
        _ftsIndex[fileId] = {
          text: cached.fulltext,
          pages: cached.page_count || 0,
          src: 'cache',
        };
        _progress.cached++;
        return { src: 'cache' };
      }
      return extractPdfText(fileId).then(function(result) {
        _ftsIndex[fileId] = {
          text: result.text,
          pages: result.pages,
          src: 'extracted',
        };
        _progress.extracted++;
        // Schreibe Cache (max 1 MB Text)
        return writeCache(fileId, {
          fulltext: result.text.substring(0, 1000000),
          page_count: result.pages,
          extracted_at: new Date().toISOString(),
        }).then(function() {
          return { src: 'extracted' };
        });
      });
    }).catch(function(e) {
      console.warn('[FTS] Fehler bei', file.name, ':', e.message);
      _progress.errors++;
      _ftsIndex[fileId] = { text: '', pages: 0, src: 'error', error: e.message };
      return { src: 'error' };
    });
  }

  function startIndexing() {
    if (_indexing) return;
    _indexing = true;
    _abort = { stopped: false };

    loadPdfJs().then(function(lib) {
      if (!lib) { _indexing = false; _uiUpdate('error', 'PDF.js konnte nicht geladen werden'); return; }
      return ensureDefinition();
    }).then(function(ok) {
      if (!ok) { _indexing = false; _uiUpdate('error', 'Cache-Definition Fehler'); return; }

      var pdfFiles = baseFiles.filter(function(f) {
        return f.name && f.name.toLowerCase().endsWith('.pdf');
      });

      _progress = { done: 0, total: pdfFiles.length, cached: 0, extracted: 0, errors: 0 };
      _uiUpdate('indexing', '0/' + pdfFiles.length + ' PDFs');

      var i = 0;
      var BATCH_SIZE = 3;

      function nextBatch() {
        if (_abort.stopped || i >= pdfFiles.length) {
          _indexing = false;
          _uiUpdate('ready',
            _progress.extracted + ' extrahiert, ' +
            _progress.cached + ' aus Cache | ' +
            pdfFiles.length + ' PDFs'
          );
          console.log('[FTS] Fertig:', _progress);
          return;
        }
        var batch = pdfFiles.slice(i, i + BATCH_SIZE);
        i += BATCH_SIZE;
        Promise.all(batch.map(function(file) {
          return indexOne(file).then(function() { _progress.done++; });
        })).then(function() {
          _uiUpdate('indexing', _progress.done + '/' + _progress.total + ' PDFs');
          nextBatch();
        });
      }
      nextBatch();
    });
  }

  function stopIndexing() {
    if (_abort) _abort.stopped = true;
    _indexing = false;
    _uiUpdate('stopped', 'Gestoppt');
  }

  function ftsSearch(query) {
    if (!query || query.length < 2) return [];
    var terms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length >= 2; });
    var results = [];

    for (var fi = 0; fi < baseFiles.length; fi++) {
      var file = baseFiles[fi];
      var fileId = getFileId(file);
      if (!fileId) continue;
      if (typeof fileMatchesActiveTypes === 'function' && !fileMatchesActiveTypes(file)) continue;

      var entry = _ftsIndex[fileId];
      var name = (file.name || '').toLowerCase();
      var path = (file._path || '').toLowerCase();
      var content = entry && entry.text ? entry.text.toLowerCase() : '';

      var score = 0;
      var matchFields = [];
      var snippets = [];

      for (var ti = 0; ti < terms.length; ti++) {
        var term = terms[ti];

        if (name.indexOf(term) >= 0) {
          score += 10;
          if (matchFields.indexOf('Name') < 0) matchFields.push('Name');
        }
        if (path.indexOf(term) >= 0) {
          score += 3;
          if (matchFields.indexOf('Pfad') < 0) matchFields.push('Pfad');
        }
        if (content.indexOf(term) >= 0) {
          var occurrences = content.split(term).length - 1;
          score += 5 * Math.min(occurrences, 10);
          if (matchFields.indexOf('Inhalt') < 0) matchFields.push('Inhalt');
          var ci = content.indexOf(term);
          var s0 = Math.max(0, ci - 50);
          var s1 = Math.min(content.length, ci + term.length + 50);
          var snippet = (s0 > 0 ? '...' : '') + content.substring(s0, s1) + (s1 < content.length ? '...' : '');
          if (snippets.length < 3) snippets.push(snippet);
        }
      }

      if (score > 0) {
        results.push({
          file: file,
          fileId: fileId,
          score: score,
          matchFields: matchFields,
          snippets: snippets,
          pages: entry ? entry.pages : 0,
          src: entry ? entry.src : 'unknown',
        });
      }
    }

    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  }

  function renderResults(results, query) {
    var el;
    el = document.getElementById('stateLoading'); if (el) el.style.display = 'none';
    el = document.getElementById('stateError'); if (el) el.style.display = 'none';
    el = document.getElementById('stateEmpty'); if (el) el.style.display = 'none';
    el = document.getElementById('tableWrap'); if (el) el.style.display = 'block';
    el = document.querySelector('.content-split'); if (el) el.style.display = 'flex';

    var tbody = document.getElementById('tableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#7a8199">' +
        'Keine Treffer f\u00fcr "' + escHtml(query) + '"' +
        (_indexing ? '<br><small>(Indexierung l\u00e4uft noch...)</small>' : '') + '</td></tr>';
      setStatus('ok', '0 Treffer');
      return;
    }

    var bc = { 'Name': '#00c2ff', 'Pfad': '#7a8199', 'Inhalt': '#22d3a0' };
    var qw = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length >= 2; });

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
      for (var bi = 0; bi < r.matchFields.length; bi++) {
        var bf = r.matchFields[bi];
        badges += '<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:8px;background:' +
          (bc[bf] || '#7a8199') + ';color:#000;font-weight:600;margin-left:4px">' + bf + '</span>';
      }
      if (r.pages > 0) {
        badges += '<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:8px;background:#1a1d27;color:#7a8199;margin-left:4px">' + r.pages + 'p</span>';
      }

      var snippetHtml = '';
      if (r.snippets.length > 0) {
        var combined = r.snippets.join(' · ');
        var shown = escHtml(combined);
        for (var qi = 0; qi < qw.length; qi++) {
          shown = shown.replace(new RegExp('(' + qw[qi].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
            '<mark style="background:#f59e0b;color:#000;padding:0 2px;border-radius:2px">$1</mark>');
        }
        snippetHtml = '<div style="font-size:10px;color:#7a8199;margin-top:3px;max-width:600px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic">' + shown + '</div>';
      }

      var tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #2a2d3e';
      tr.innerHTML =
        '<td style="padding:10px 12px"><div style="display:flex;flex-direction:column;gap:2px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            getFileIconHtml(name) +
            '<span onclick="openFile(' + idx + ')" style="color:#00c2ff;font-family:var(--font);font-size:12.5px;font-weight:500;cursor:pointer">' + escHtml(name) + '</span>' +
            badges +
          '</div>' + snippetHtml +
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
    lbl.title = 'Echte Volltextsuche: Extrahiert Text aus allen PDF-Seiten';
    lbl.innerHTML = '<input type="checkbox" id="ftsCheck" style="accent-color:#22d3a0" /><span>Volltext</span>';

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
    if (cb) cb.addEventListener('change', function() {
      if (cb.checked) startIndexing();
      else { stopIndexing(); pill.style.display = 'none'; _doFilter(); }
    });

    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.removeAttribute('oninput');
      searchInput.addEventListener('input', _doFilter);
    }

    var scopeCheck = document.getElementById('searchScopeCheck');
    if (scopeCheck) {
      scopeCheck.removeAttribute('onchange');
      scopeCheck.addEventListener('change', _doFilter);
    }
  }

  function _doFilter() {
    var ftsCb = document.getElementById('ftsCheck');
    var ftsOn = ftsCb && ftsCb.checked;
    var inp = document.getElementById('searchInput');
    var query = inp ? inp.value.trim() : '';
    var scopeCheck = document.getElementById('searchScopeCheck');
    var searchAll = scopeCheck && scopeCheck.checked;

    if (ftsOn && query.length >= 2) {
      var results = ftsSearch(query);
      console.log('[FTS] Suche "' + query + '": ' + results.length + ' Treffer');
      renderResults(results, query);
      return;
    }
    if (ftsOn && query.length < 2) {
      searchResultFiles = null; allFiles = baseFiles.slice();
      if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
        searchAllAbortController.abort(); searchAllAbortController = null;
      }
      renderTable();
      return;
    }
    if (searchAll && query) {
      if (typeof searchEntireProject === 'function') searchEntireProject(query);
    } else {
      searchResultFiles = null; allFiles = baseFiles.slice();
      if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
        searchAllAbortController.abort(); searchAllAbortController = null;
      }
      renderTable();
    }
  }

  window.filterTable = _doFilter;
  window.fulltextSearch = ftsSearch;
  window.renderFtsResults = renderResults;
  window.ftsIndex = _ftsIndex;
  window.startFtsIndexing = startIndexing;
  window.stopFtsIndexing = stopIndexing;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initUI);
  else setTimeout(_initUI, 500);

  console.log('[FTS] Volltextsuche v7 geladen (PDF.js + Download-Endpoint, Schema fixed)');
})();
