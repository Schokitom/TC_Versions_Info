// ═══════════════════════════════════════════════════════════════
//  S+L Explorer — Volltextsuche v10
//  Indexiert nur sichtbare Dateien (basierend auf DOM-Sichtbarkeit)
// ═══════════════════════════════════════════════════════════════
(function() {

  var PROXY_URL = 'https://slproxy.schoknechtthomas.workers.dev';
  var PSET_REGION = 'eu-west-1';
  var DEF_ID = 'sl-pdf-fulltext';
  var TC_BASE = 'https://app21.connect.trimble.com';

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
  var CMAP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/cmaps/';
  var FONT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/standard_fonts/';

  var _pdfjsLib = null;
  var _ftsCache = {};
  var _indexing = false;
  var _abort = null;
  var _progress = { done: 0, total: 0, cached: 0, extracted: 0, errors: 0 };
  var _libId = null;
  var _defReady = false;
  var _indexedFileIds = {};
  var _ftsSearchVisible = false;

  function loadPdfJs() {
    if (_pdfjsLib) return Promise.resolve(_pdfjsLib);
    return import(PDFJS_URL).then(function(lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      _pdfjsLib = lib;
      return lib;
    });
  }

  function loadPdfDocument(buf) {
    return _pdfjsLib.getDocument({
      data: buf, cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: FONT_URL,
    }).promise;
  }

  function psetFetch(path, method, body) {
    var opts = {
      method: method || 'GET',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(PROXY_URL + '/pset/' + PSET_REGION + path, opts).then(function(r) {
      return r.text().then(function(t) {
        var data; try { data = JSON.parse(t); } catch(e) { data = t; }
        return { status: r.status, ok: r.ok, data: data };
      });
    });
  }

  function ensureDefinition() {
    if (_defReady) return Promise.resolve(true);
    _libId = 'tcproject:prod:' + projectId;
    return psetFetch('/libs/' + _libId + '/defs/' + DEF_ID, 'GET').then(function(r) {
      if (r.ok) { _defReady = true; return true; }
      return psetFetch('/libs/' + _libId + '/defs', 'POST', {
        id: DEF_ID, name: 'S+L PDF Volltext-Cache',
        schema: { open: true, props: {
          'fulltext': { type: 'string' },
          'page_count': { type: 'integer' },
          'extracted_at': { type: 'string', format: 'date-time' },
        }}
      }).then(function(r2) {
        if (r2.ok || r2.status === 201) { _defReady = true; return true; }
        return false;
      });
    });
  }

  function readPSetCache(fileId) {
    var link = 'frn:tcfile:' + fileId;
    return psetFetch('/psets/' + encodeURIComponent(link) + '/' + encodeURIComponent(_libId) + '/' + DEF_ID, 'GET')
      .then(function(r) { return (r.ok && r.data && r.data.props) ? r.data.props : null; })
      .catch(function() { return null; });
  }

  function writePSetCache(fileId, data) {
    var link = 'frn:tcfile:' + fileId;
    return psetFetch('/psets/' + encodeURIComponent(link) + '/' + encodeURIComponent(_libId) + '/' + DEF_ID, 'PUT', { props: data })
      .then(function(r) { return r.ok; })
      .catch(function() { return false; });
  }

  function refreshToken() {
    return new Promise(function(resolve) {
      if (typeof workspaceAPI !== 'undefined' && workspaceAPI) {
        workspaceAPI.requestPermission(function(token) {
          if (token) {
            accessToken = token;
            console.log('[FTS] Token erneuert');
            resolve(true);
          } else if (typeof workspaceAPI.getAccessToken === 'function') {
            workspaceAPI.getAccessToken(function(t) {
              if (t) { accessToken = t; }
              resolve(!!t);
            });
          } else { resolve(false); }
        });
        setTimeout(function() { resolve(false); }, 8000);
      } else { resolve(false); }
    });
  }

  function getDownloadUrl(fileId, _isRetry) {
    return fetch(PROXY_URL + '/core-fs/' + fileId + '/downloadurl?base=' + TC_BASE, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }).then(function(r) {
      if ((r.status === 401 || r.status === 403) && !_isRetry) {
        console.log('[FTS] Token abgelaufen, erneuere...');
        return refreshToken().then(function(ok) {
          if (ok) return getDownloadUrl(fileId, true);
          throw new Error('Token-Erneuerung fehlgeschlagen');
        });
      }
      if (!r.ok) throw new Error('DL-URL ' + r.status);
      return r.json();
    }).then(function(d) { return d.url; });
  }

  function extractText(fileId) {
    return getDownloadUrl(fileId).then(function(url) {
      return fetch(url);
    }).then(function(r) {
      if (!r.ok) throw new Error('PDF ' + r.status);
      return r.arrayBuffer();
    }).then(function(buf) {
      return loadPdfDocument(buf);
    }).then(function(pdf) {
      var promises = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        promises.push(pdf.getPage(i).then(function(p) {
          return p.getTextContent().then(function(c) {
            return c.items.map(function(it) { return it.str; }).join(' ');
          });
        }));
      }
      return Promise.all(promises).then(function(texts) {
        return { text: texts.join('\n\n'), pages: pdf.numPages };
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SICHTBARE PDFs ermitteln — basierend auf DOM
  //  Die Filterung im Explorer passiert nur visuell (tr.style.display)
  //  allFiles wird NICHT reduziert, deshalb müssen wir die sichtbaren
  //  Tabellenzeilen auslesen und deren Index in allFiles ermitteln.
  // ═══════════════════════════════════════════════════════════════
  function getVisiblePdfFiles() {
    var visibleFiles = [];
    var rows = document.querySelectorAll('#tableBody tr');
    rows.forEach(function(tr) {
      if (tr.style.display === 'none') return;

      // Index aus den Buttons in der Zeile extrahieren (onclick="openFile(X)")
      // oder aus dem prev-btn ID (prev-btn-X)
      var prevBtn = tr.querySelector('.prev-btn');
      if (!prevBtn) return;
      var btnId = prevBtn.id || '';
      var match = btnId.match(/prev-btn-(\d+)/);
      if (!match) return;
      var idx = parseInt(match[1], 10);
      if (isNaN(idx) || idx < 0 || idx >= allFiles.length) return;

      var file = allFiles[idx];
      if (!file) return;
      if (!file.name || !file.name.toLowerCase().endsWith('.pdf')) return;

      visibleFiles.push(file);
    });
    return visibleFiles;
  }

  // ─── Indexierung ───
  function indexOne(file) {
    var fileId = getFileId(file);
    if (!fileId) return Promise.resolve();

    if (_ftsCache[fileId] && _ftsCache[fileId].text) {
      _progress.cached++;
      return Promise.resolve();
    }

    return readPSetCache(fileId).then(function(cached) {
      if (cached && cached.fulltext) {
        _ftsCache[fileId] = { text: cached.fulltext, pages: cached.page_count || 0, src: 'pset' };
        _progress.cached++;
        return;
      }
      return extractText(fileId).then(function(result) {
        _ftsCache[fileId] = { text: result.text, pages: result.pages, src: 'extracted' };
        _progress.extracted++;
        return writePSetCache(fileId, {
          fulltext: result.text.substring(0, 1000000),
          page_count: result.pages,
          extracted_at: new Date().toISOString(),
        });
      });
    }).catch(function(e) {
      console.warn('[FTS] Fehler:', file.name, e.message);
      _ftsCache[fileId] = { text: '', pages: 0, src: 'error' };
      _progress.errors++;
    });
  }

  function startIndexing() {
    if (_indexing) return;

    // Sichtbare PDFs aus dem DOM ermitteln
    var pdfFiles = getVisiblePdfFiles();

    console.log('[FTS] Sichtbare PDFs:', pdfFiles.length, '(von', allFiles.length, 'gesamt)');

    if (pdfFiles.length === 0) {
      updateFtsButton('error', 'Keine PDFs in der aktuellen Ansicht');
      return;
    }

    // Prüfen ob alle schon im lokalen Cache
    var allCached = pdfFiles.every(function(f) {
      var id = getFileId(f);
      return id && _ftsCache[id] && _ftsCache[id].text;
    });

    if (allCached) {
      _indexedFileIds = {};
      pdfFiles.forEach(function(f) { var id = getFileId(f); if (id) _indexedFileIds[id] = true; });
      updateFtsButton('ready', pdfFiles.length + ' PDFs aus Cache');
      showFtsSearch();
      return;
    }

    _indexing = true;
    _abort = { stopped: false };
    updateFtsButton('indexing', '0/' + pdfFiles.length);

    loadPdfJs().then(function(lib) {
      if (!lib) { _indexing = false; updateFtsButton('error', 'PDF.js Fehler'); return; }
      return ensureDefinition();
    }).then(function(ok) {
      if (!ok) { _indexing = false; updateFtsButton('error', 'Cache-Fehler'); return; }

      _progress = { done: 0, total: pdfFiles.length, cached: 0, extracted: 0, errors: 0 };

      var i = 0;
      var BATCH = 3;

      function nextBatch() {
        if (_abort.stopped || i >= pdfFiles.length) {
          _indexing = false;
          _indexedFileIds = {};
          pdfFiles.forEach(function(f) { var id = getFileId(f); if (id) _indexedFileIds[id] = true; });
          var msg = _progress.extracted + ' neu, ' + _progress.cached + ' Cache (' + pdfFiles.length + ' PDFs)';
          updateFtsButton('ready', msg);
          showFtsSearch();
          console.log('[FTS] Fertig:', _progress);
          return;
        }
        var batch = pdfFiles.slice(i, i + BATCH);
        i += BATCH;
        Promise.all(batch.map(function(f) {
          return indexOne(f).then(function() { _progress.done++; });
        })).then(function() {
          updateFtsButton('indexing', _progress.done + '/' + _progress.total);
          nextBatch();
        });
      }
      nextBatch();
    });
  }

  // ─── Suche ───
  function ftsSearch(query) {
    if (!query || query.length < 2) return [];
    var terms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length >= 2; });
    var results = [];

    for (var fi = 0; fi < allFiles.length; fi++) {
      var file = allFiles[fi];
      var fileId = getFileId(file);
      if (!fileId) continue;
      if (!_indexedFileIds[fileId]) continue;

      var entry = _ftsCache[fileId];
      if (!entry || !entry.text) continue;

      var content = entry.text.toLowerCase();
      var name = (file.name || '').toLowerCase();
      var score = 0;
      var snippets = [];

      for (var ti = 0; ti < terms.length; ti++) {
        var term = terms[ti];
        if (content.indexOf(term) >= 0) {
          var occ = content.split(term).length - 1;
          score += 5 * Math.min(occ, 10);
          var ci = content.indexOf(term);
          var s0 = Math.max(0, ci - 50);
          var s1 = Math.min(content.length, ci + term.length + 50);
          if (snippets.length < 3) {
            snippets.push((s0 > 0 ? '...' : '') + content.substring(s0, s1) + (s1 < content.length ? '...' : ''));
          }
        }
        if (name.indexOf(term) >= 0) score += 3;
      }

      if (score > 0) {
        results.push({ file: file, fileId: fileId, score: score, snippets: snippets, pages: entry.pages });
      }
    }

    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  }

  // ─── Ergebnisse rendern ───
  function renderFtsResults(results, query) {
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
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#7a8199">Keine Treffer f\u00fcr "' + escHtml(query) + '" im PDF-Inhalt</td></tr>';
      setStatus('ok', '0 Volltexttreffer');
      return;
    }

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

      var badges = '<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:8px;background:#22d3a0;color:#000;font-weight:600;margin-left:4px">Inhalt</span>';
      if (r.pages > 0) badges += '<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:8px;background:#1a1d27;color:#7a8199;margin-left:4px">' + r.pages + 'p</span>';

      var snippetHtml = '';
      if (r.snippets.length > 0) {
        var combined = r.snippets.join(' \u00b7 ');
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
        '<td style="padding:10px 12px"><div style="display:flex;flex-direction:column;gap:2px"><div style="display:flex;align-items:center;gap:8px">' +
          getFileIconHtml(name) +
          '<span onclick="openFile(' + idx + ')" style="color:#00c2ff;font-family:var(--font);font-size:12.5px;font-weight:500;cursor:pointer">' + escHtml(name) + '</span>' +
          badges + '</div>' + snippetHtml + '</div></td>' +
        '<td style="padding:10px 12px"><div class="user-chip"><div class="avatar">' + escHtml(init) + '</div><span>' + escHtml(modBy) + '</span></div></td>' +
        '<td style="padding:10px 12px;font-family:var(--font);font-size:11px;color:#7a8199;white-space:nowrap">' + modAt + '</td>' +
        '<td style="padding:10px 12px;text-align:center"><span class="version-badge" onclick="openVersionModal(' + idx + ',\'' + escHtml(name).replace(/'/g,"\\'") + '\')">' + ver + '</span></td>' +
        '<td style="padding:10px 12px;font-family:var(--font);font-size:11px;color:#7a8199">' + escHtml(path) + '</td>' +
        '<td class="actions-td" style="text-align:center;padding:10px 12px"><div style="display:inline-flex;gap:4px">' +
          '<button class="prev-btn" id="prev-btn-' + idx + '" onclick="openPreview(' + idx + ')" title="Vorschau"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>' +
          '<button class="dl-btn" onclick="downloadFile(' + idx + ')" title="Download"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M5 20h14v-2H5v2zm7-14v8.17l-2.59-2.58L8 13l4 4 4-4-1.41-1.41L13 14.17V6h-1z"/></svg></button>' +
        '</div></td>';
      tbody.appendChild(tr);
    }

    setStatus('ok', results.length + ' Volltexttreffer');
  }

  // ═══════════════════════════════════════════════════════════════
  //  UI
  // ═══════════════════════════════════════════════════════════════
  function injectFtsUI() {
    if (document.getElementById('sl-fts-wrap')) return;
    var toolbar = document.getElementById('toolbar');
    if (!toolbar) return;

    var css = document.createElement('style');
    css.textContent =
      '#sl-fts-wrap{display:flex;align-items:center;gap:6px;flex-shrink:0}' +
      '#sl-fts-btn{display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:12px;font-family:var(--font-ui);color:var(--text);cursor:pointer;transition:all .15s;white-space:nowrap}' +
      '#sl-fts-btn:hover{border-color:var(--accent);color:var(--accent)}' +
      '#sl-fts-btn.indexing{border-color:#f59e0b;color:#f59e0b;cursor:wait}' +
      '#sl-fts-btn.ready{border-color:#22d3a0;color:#22d3a0}' +
      '#sl-fts-btn.error{border-color:#ef4444;color:#ef4444}' +
      '#sl-fts-btn svg{width:14px;height:14px;fill:currentColor}' +
      '#sl-fts-status{font-family:var(--font);font-size:10px;color:#7a8199;white-space:nowrap}' +
      '#sl-fts-search-wrap{display:none;position:relative;flex-shrink:1;min-width:140px;max-width:280px}' +
      '#sl-fts-search-wrap.visible{display:block}' +
      '#sl-fts-search{width:100%;background:var(--bg);border:1px solid #22d3a0;border-radius:6px;padding:6px 10px 6px 28px;font-size:12px;color:var(--text);font-family:var(--font-ui);outline:none;transition:border-color .2s}' +
      '#sl-fts-search:focus{border-color:#00c2ff}' +
      '#sl-fts-search::placeholder{color:#7a8199}' +
      '#sl-fts-search-wrap svg{position:absolute;left:8px;top:50%;transform:translateY(-50%);width:13px;height:13px;fill:#22d3a0}' +
      '@keyframes sl-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(css);

    var wrap = document.createElement('div');
    wrap.id = 'sl-fts-wrap';

    var btn = document.createElement('button');
    btn.id = 'sl-fts-btn';
    btn.title = 'Aktuell angezeigte PDFs f\u00fcr Volltextsuche indexieren';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>Volltextsuche';
    btn.onclick = function() { startIndexing(); };
    wrap.appendChild(btn);

    var status = document.createElement('span');
    status.id = 'sl-fts-status';
    wrap.appendChild(status);

    var searchWrap = document.createElement('div');
    searchWrap.id = 'sl-fts-search-wrap';
    searchWrap.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'sl-fts-search';
    searchInput.placeholder = 'PDF-Inhalt durchsuchen\u2026';
    searchInput.addEventListener('input', function() {
      var query = searchInput.value.trim();
      if (query.length >= 2) {
        var results = ftsSearch(query);
        console.log('[FTS] Suche "' + query + '": ' + results.length + ' Treffer');
        renderFtsResults(results, query);
      } else if (query.length < 2) {
        restoreNormalTable();
      }
    });
    searchWrap.appendChild(searchInput);
    wrap.appendChild(searchWrap);

    var statPill = toolbar.querySelector('.stat-pill');
    if (statPill) toolbar.insertBefore(wrap, statPill);
    else toolbar.appendChild(wrap);
  }

  function updateFtsButton(state, msg) {
    var btn = document.getElementById('sl-fts-btn');
    var status = document.getElementById('sl-fts-status');
    if (!btn) return;
    btn.className = '';
    if (state === 'indexing') {
      btn.className = 'indexing';
      btn.innerHTML = '<svg viewBox="0 0 24 24" style="animation:sl-spin .7s linear infinite"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>Indexiere\u2026';
    } else if (state === 'ready') {
      btn.className = 'ready';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Volltext \u2713';
    } else if (state === 'error') {
      btn.className = 'error';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>Fehler';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>Volltextsuche';
    }
    if (status) status.textContent = msg || '';
  }

  function showFtsSearch() {
    var wrap = document.getElementById('sl-fts-search-wrap');
    if (wrap) { wrap.classList.add('visible'); _ftsSearchVisible = true; }
  }

  function hideFtsSearch() {
    var wrap = document.getElementById('sl-fts-search-wrap');
    if (wrap) { wrap.classList.remove('visible'); _ftsSearchVisible = false; }
    var input = document.getElementById('sl-fts-search');
    if (input) input.value = '';
  }

  function restoreNormalTable() {
    searchResultFiles = null;
    allFiles = baseFiles.slice();
    if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
      searchAllAbortController.abort(); searchAllAbortController = null;
    }
    renderTable();
  }

  // ═══════════════════════════════════════════════════════════════
  //  DATEIÄNDERUNGS-ERKENNUNG
  // ═══════════════════════════════════════════════════════════════
  var _lastBaseFilesSignature = null;

  function getBaseFilesSignature() {
    return baseFiles.map(function(f) { return getFileId(f); }).sort().join(',');
  }

  function checkForFileChanges() {
    var sig = getBaseFilesSignature();
    if (_lastBaseFilesSignature !== null && sig !== _lastBaseFilesSignature) {
      hideFtsSearch();
      _indexedFileIds = {};
      updateFtsButton('default', '');
    }
    _lastBaseFilesSignature = sig;
  }

  setInterval(checkForFileChanges, 500);

  // ═══════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════
  function init() {
    var toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    injectFtsUI();

    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.removeAttribute('oninput');
      searchInput.addEventListener('input', function() {
        if (_ftsSearchVisible) {
          hideFtsSearch();
          _indexedFileIds = {};
          updateFtsButton('default', '');
        }
        _doFilter();
      });
    }

    var scopeCheck = document.getElementById('searchScopeCheck');
    if (scopeCheck) {
      scopeCheck.removeAttribute('onchange');
      scopeCheck.addEventListener('change', function() { _doFilter(); });
    }

    // ═══ "Aktualisieren" Button → "Reset" Button umwandeln ═══
    convertResetButton();
  }

  // ═══════════════════════════════════════════════════════════════
  //  RESET-BUTTON
  //  Ersetzt den "Aktualisieren" Button durch einen "Reset" Button
  //  der alle Filter zurücksetzt (außer Dateiarten + Baumstruktur)
  // ═══════════════════════════════════════════════════════════════
  function convertResetButton() {
    // Button finden: der letzte .btn.primary im Toolbar mit onclick="loadFiles()"
    var toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    var buttons = toolbar.querySelectorAll('.btn.primary');
    var resetBtn = null;
    for (var i = 0; i < buttons.length; i++) {
      var attr = buttons[i].getAttribute('onclick');
      if (attr && attr.indexOf('loadFiles') >= 0) {
        resetBtn = buttons[i];
        break;
      }
    }
    if (!resetBtn) return;

    // Button umgestalten
    resetBtn.removeAttribute('onclick');
    resetBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>' +
      'Reset';
    resetBtn.title = 'Alle Filter zur\u00fccksetzen (Dateiarten und Ordnerauswahl bleiben)';
    resetBtn.onclick = function() { doReset(); };
  }

  function doReset() {
    // 1. Suchfeld leeren
    var searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    // 2. "Gesamten Explorer" Checkbox deaktivieren
    var scopeCheck = document.getElementById('searchScopeCheck');
    if (scopeCheck) scopeCheck.checked = false;

    // 3. searchResultFiles zurücksetzen
    searchResultFiles = null;

    // 4. Abort laufende Suchen
    if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
      searchAllAbortController.abort();
      searchAllAbortController = null;
    }

    // 5. Volltextsuche zurücksetzen
    hideFtsSearch();
    _indexedFileIds = {};
    updateFtsButton('default', '');

    // 6. Pfadfilter zurücksetzen (alle Pfade auswählen)
    if (typeof selectAllPaths === 'function') {
      try { selectAllPaths(); } catch(e) {}
    }

    // 7. allFiles auf baseFiles zurücksetzen
    allFiles = baseFiles.slice();

    // 8. Tabelle neu rendern
    renderTable();

    // 9. Status aktualisieren
    setStatus('ok', 'Filter zur\u00fcckgesetzt');
  }

  var _searchAllDebounce = null;

  function _doFilter() {
    var inp = document.getElementById('searchInput');
    var query = inp ? inp.value.trim() : '';
    var scopeCheck = document.getElementById('searchScopeCheck');
    var searchAll = scopeCheck && scopeCheck.checked;

    if (searchAll && query.length >= 2) {
      // Debounce: Warte 400ms nach letztem Tastendruck bevor gesucht wird
      if (_searchAllDebounce) clearTimeout(_searchAllDebounce);
      _searchAllDebounce = setTimeout(function() {
        if (typeof searchEntireProject === 'function') {
          searchEntireProject(query.toLowerCase());
        }
      }, 400);
      return;
    } else {
      if (_searchAllDebounce) { clearTimeout(_searchAllDebounce); _searchAllDebounce = null; }
      searchResultFiles = null;
      allFiles = baseFiles.slice();
      if (typeof searchAllAbortController !== 'undefined' && searchAllAbortController) {
        searchAllAbortController.abort(); searchAllAbortController = null;
      }
      renderTable();
    }
  }

  window.filterTable = _doFilter;
  window.fulltextSearch = ftsSearch;
  window.ftsCache = _ftsCache;

  // ═══════════════════════════════════════════════════════════════
  //  LIVE-ZÄHLER: totalCount immer auf sichtbare Zeilen aktualisieren
  //  Funktioniert für ALLE Filter (Name, Typ, Pfad, Gesamtsuche, FTS)
  // ═══════════════════════════════════════════════════════════════
  function updateVisibleCount() {
    var el = document.getElementById('totalCount');
    if (!el) return;
    var rows = document.querySelectorAll('#tableBody tr');
    var count = 0;
    rows.forEach(function(tr) {
      // Leere Info-Zeilen (z.B. "Keine Treffer") nicht zählen
      if (tr.style.display === 'none') return;
      if (tr.querySelector('td[colspan]')) return;
      count++;
    });
    el.textContent = count;
  }

  // MutationObserver: Zählt nach jeder Änderung am tableBody
  function setupCountObserver() {
    var tbody = document.getElementById('tableBody');
    if (!tbody) return;
    var observer = new MutationObserver(function() {
      // Kurz warten damit renderTable() fertig ist (display:none wird nach innerHTML gesetzt)
      setTimeout(updateVisibleCount, 50);
    });
    observer.observe(tbody, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

    // Auch bei Scroll-Events prüfen (für den Fall dass renderTable display ändert)
    // Initial zählen
    setTimeout(updateVisibleCount, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { init(); setupCountObserver(); setupTreeHighlight(); });
  else setTimeout(function() { init(); setupCountObserver(); setupTreeHighlight(); }, 500);

  // ═══════════════════════════════════════════════════════════════
  //  BAUM-HIGHLIGHTING: Eltern-Ordner markieren wenn Kinder
  //  angehakt sind (indeterminate-Style)
  // ═══════════════════════════════════════════════════════════════
  function updateTreeParentHighlight() {
    var treeBody = document.getElementById('treeBody');
    if (!treeBody) return;

    // Erst alle indeterminate entfernen
    var allRows = treeBody.querySelectorAll('.tree-row');
    for (var i = 0; i < allRows.length; i++) {
      allRows[i].classList.remove('has-checked-child');
    }

    // Alle checked Nodes finden
    var checkedRows = treeBody.querySelectorAll('.tree-row.checked');
    checkedRows.forEach(function(checkedRow) {
      // Nach oben traversieren: .tree-node → parent .tree-children → parent .tree-node → .tree-row
      var node = checkedRow.closest('.tree-node');
      if (!node) return;
      var parent = node.parentElement;
      while (parent) {
        if (parent.classList && parent.classList.contains('tree-children')) {
          var parentNode = parent.closest('.tree-node');
          if (parentNode) {
            var parentRow = parentNode.querySelector(':scope > .tree-row');
            if (parentRow && !parentRow.classList.contains('checked')) {
              parentRow.classList.add('has-checked-child');
            }
          }
        }
        // Weiter nach oben
        parent = parent.parentElement;
        if (parent && parent.id === 'treeBody') break;
      }
    });
  }

  function setupTreeHighlight() {
    var treeBody = document.getElementById('treeBody');
    if (!treeBody) return;

    // CSS für has-checked-child injizieren
    var style = document.createElement('style');
    style.textContent =
      '.tree-row.has-checked-child .tree-checkbox { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }' +
      '.tree-row.has-checked-child .tree-label { color: var(--accent); opacity: 0.7; }';
    document.head.appendChild(style);

    // MutationObserver auf den Baum — reagiert auf class-Änderungen (checked/unchecked)
    var observer = new MutationObserver(function() {
      setTimeout(updateTreeParentHighlight, 50);
    });
    observer.observe(treeBody, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
    });

    // Initial ausführen
    setTimeout(updateTreeParentHighlight, 1000);
  }

  console.log('[FTS] Volltextsuche v10 geladen (DOM-basierte Sichtbarkeit)');
})();
