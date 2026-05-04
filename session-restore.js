/**
 * session-restore.js v2 — S+L Explorer Session-Restore Modul
 *
 * Speichert den Explorer-Zustand (angehakte Ordner, aufgeklappte Nodes,
 * Dateiart-Filter, Suchfeld) periodisch in sessionStorage.
 * Nach einem Reload wird der Zustand automatisch wiederhergestellt.
 *
 * Einbindung (NACH index.html und viewer):
 *   <script src="session-restore.js"></script>
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'sl-session-state';
  var SAVE_INTERVAL_MS = 10000; // 10 Sekunden
  var MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 Stunden

  // =========================================================================
  // 1. Zustand sammeln
  // =========================================================================

  function collectState() {
    // Angehakte Ordner: aus checkedFolderIds (Set in index.html)
    var checkedFolders = [];
    if (typeof checkedFolderIds !== 'undefined' && checkedFolderIds) {
      if (checkedFolderIds instanceof Set) {
        checkedFolderIds.forEach(function (id) { checkedFolders.push(id); });
      } else {
        // Falls es ein Object ist (ältere Version)
        checkedFolders = Object.keys(checkedFolderIds);
      }
    }

    // Aufgeklappte Baum-Nodes (DOM-basiert: .tree-toggle.open)
    var openNodes = [];
    document.querySelectorAll('.tree-toggle.open').forEach(function (toggle) {
      var node = toggle.closest('.tree-node');
      if (node && node.dataset.id) {
        openNodes.push(node.dataset.id);
      }
    });

    // Dateiart-Filter: aus activeFileTypes (Set in index.html)
    var activeTypes = [];
    if (typeof activeFileTypes !== 'undefined' && activeFileTypes) {
      if (activeFileTypes instanceof Set) {
        activeFileTypes.forEach(function (t) { activeTypes.push(t); });
      } else {
        activeTypes = Object.keys(activeFileTypes);
      }
    }

    // Suchfeld
    var searchInput = document.getElementById('searchInput');
    var searchText = searchInput ? searchInput.value : '';

    // Scope-Toggle (Gesamten Explorer durchsuchen)
    var scopeCheck = document.getElementById('searchScopeCheck');
    var searchScope = scopeCheck ? scopeCheck.checked : false;

    return {
      projectId: typeof projectId !== 'undefined' ? projectId : null,
      timestamp: Date.now(),
      checkedFolders: checkedFolders,
      openNodes: openNodes,
      activeTypes: activeTypes,
      searchText: searchText,
      searchScope: searchScope
    };
  }

  // =========================================================================
  // 2. Speichern
  // =========================================================================

  function saveState() {
    try {
      var state = collectState();
      // Nur speichern wenn projectId vorhanden (Extension ist initialisiert)
      if (!state.projectId) return;
      // Nur speichern wenn der Baum existiert (mindestens 1 Node)
      if (document.querySelectorAll('.tree-node').length === 0) return;
      // Nur speichern wenn mindestens 1 Ordner angehakt ist (sonst gibt es nichts wiederherzustellen)
      if (state.checkedFolders.length === 0) return;

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[session-restore] Speichern fehlgeschlagen:', e);
    }
  }

  // =========================================================================
  // 3. Laden & Validieren
  // =========================================================================

  function loadSavedState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      var state = JSON.parse(raw);

      // Timestamp prüfen
      if (!state.timestamp || (Date.now() - state.timestamp) > MAX_AGE_MS) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }

      // projectId prüfen (muss mit aktuellem Projekt übereinstimmen)
      if (typeof projectId !== 'undefined' && state.projectId && state.projectId !== projectId) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }

      return state;
    } catch (e) {
      console.warn('[session-restore] Laden fehlgeschlagen:', e);
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  // =========================================================================
  // 4. Wiederherstellen
  // =========================================================================

  function restoreState(state) {
    console.log('[session-restore] Stelle Zustand wieder her...');
    console.log('[session-restore] Checked:', state.checkedFolders.length,
      '| Open:', state.openNodes.length,
      '| Types:', (state.activeTypes || []).join(','));

    // Gespeicherten Zustand verbrauchen
    sessionStorage.removeItem(STORAGE_KEY);

    // --- a) Dateiart-Filter ZUERST setzen (bevor Dateien geladen werden) ---
    restoreFileTypes(state);

    // --- b) Baum aufklappen (sequentiell, damit Eltern vor Kindern geladen) ---
    var openQueue = (state.openNodes || []).slice();

    function openNext() {
      if (openQueue.length === 0) {
        // Alle Nodes aufgeklappt → jetzt Ordner anhaken
        restoreChecked(state);
        return;
      }

      var id = openQueue.shift();
      var node = document.querySelector('.tree-node[data-id="' + id + '"]');

      if (node) {
        var toggle = node.querySelector(':scope > .tree-row > .tree-toggle');
        // Nur aufklappen wenn noch nicht offen
        if (toggle && !toggle.classList.contains('open')) {
          // Simuliere Klick auf den Toggle (das triggert lazy-loading korrekt)
          toggle.click();
        }
        // Warten damit lazy-loading abgeschlossen werden kann
        setTimeout(openNext, 300);
      } else {
        // Node nicht gefunden (evtl. noch nicht geladen) → überspringen
        console.warn('[session-restore] Node nicht gefunden:', id);
        setTimeout(openNext, 50);
      }
    }

    openNext();
  }

  function restoreFileTypes(state) {
    if (!state.activeTypes || state.activeTypes.length === 0) return;

    // activeFileTypes ist ein Set in index.html
    if (typeof activeFileTypes !== 'undefined') {
      if (activeFileTypes instanceof Set) {
        activeFileTypes.clear();
        state.activeTypes.forEach(function (t) { activeFileTypes.add(t); });
      }
    }

    // UI aktualisieren
    if (typeof updateFileTypeUI === 'function') {
      updateFileTypeUI();
    }
  }

  function restoreChecked(state) {
    // checkedFolderIds ist ein Set in index.html
    if (typeof checkedFolderIds !== 'undefined' && checkedFolderIds instanceof Set) {
      checkedFolderIds.clear();
      state.checkedFolders.forEach(function (id) {
        checkedFolderIds.add(id);
      });
    }

    // DOM-Zustand aktualisieren: .tree-row.checked für alle angehakten Ordner
    state.checkedFolders.forEach(function (id) {
      var node = document.querySelector('.tree-node[data-id="' + id + '"]');
      if (node) {
        var row = node.querySelector(':scope > .tree-row');
        if (row) row.classList.add('checked');
      } else {
        console.warn('[session-restore] Checked-Node nicht gefunden:', id);
      }
    });

    // Anwenden-Button aktualisieren
    if (typeof updateApplyBtn === 'function') {
      updateApplyBtn();
    }

    // Dateien laden (wie "Anwenden" klicken)
    console.log('[session-restore] Starte applyFolderFilter...');
    if (typeof applyFolderFilter === 'function') {
      // applyFolderFilter() nutzt checkedFolderIds → lädt die richtigen Ordner
      applyFolderFilter().then(function () {
        console.log('[session-restore] Dateien geladen. Stelle Suche wieder her...');
        restoreSearch(state);
      }).catch(function (err) {
        console.warn('[session-restore] applyFolderFilter fehlgeschlagen:', err);
      });
    }
  }

  function restoreSearch(state) {
    // Suchfeld wiederherstellen
    if (state.searchText) {
      var searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = state.searchText;
      }
    }

    // Scope-Toggle wiederherstellen
    if (state.searchScope) {
      var scopeCheck = document.getElementById('searchScopeCheck');
      if (scopeCheck) {
        scopeCheck.checked = true;
      }
    }

    // filterTable aufrufen um die Suche anzuwenden
    if (state.searchText && typeof filterTable === 'function') {
      setTimeout(function () {
        filterTable();
      }, 300);
    }

    console.log('[session-restore] Wiederherstellung abgeschlossen.');
  }

  // =========================================================================
  // 5. Globale Funktion für manuelles Speichern
  // =========================================================================

  window.slSessionRestore = {
    saveNow: saveState,
    collectState: collectState
  };

  // =========================================================================
  // 6. Initialisierung
  // =========================================================================

  function init() {
    console.log('[session-restore] Modul v2 geladen.');

    // Periodisches Speichern starten
    setInterval(saveState, SAVE_INTERVAL_MS);

    // Vor Unload ebenfalls speichern (Fallback)
    window.addEventListener('beforeunload', function () {
      saveState();
    });

    // Auf Wiederherstellung warten: rootFolderId muss gesetzt sein
    waitForReady(function () {
      var state = loadSavedState();
      if (state) {
        console.log('[session-restore] Gespeicherten Zustand gefunden von',
          new Date(state.timestamp).toLocaleTimeString(),
          '| Ordner:', state.checkedFolders.length,
          '| Types:', (state.activeTypes || []).join(','));
        // Kurz warten bis der Baum initial gerendert ist
        waitForTree(function () {
          restoreState(state);
        });
      } else {
        console.log('[session-restore] Kein gespeicherter Zustand vorhanden.');
      }
    });
  }

  /**
   * Wartet darauf, dass rootFolderId und folderTree gesetzt sind.
   */
  function waitForReady(callback) {
    var attempts = 0;
    var maxAttempts = 60; // max 30 Sekunden

    function check() {
      attempts++;
      if (typeof rootFolderId !== 'undefined' && rootFolderId &&
          typeof folderTree !== 'undefined' && folderTree && folderTree.length > 0) {
        callback();
        return;
      }
      if (attempts >= maxAttempts) {
        console.warn('[session-restore] Timeout: rootFolderId/folderTree nicht verfügbar.');
        return;
      }
      setTimeout(check, 500);
    }

    check();
  }

  /**
   * Wartet darauf, dass der Baum gerendert ist (mindestens 1 tree-node).
   */
  function waitForTree(callback) {
    var attempts = 0;
    var maxAttempts = 40; // max 20 Sekunden

    function check() {
      attempts++;
      if (document.querySelectorAll('.tree-node').length > 0) {
        // Kurz extra warten damit der DOM stabil ist
        setTimeout(callback, 200);
        return;
      }
      if (attempts >= maxAttempts) {
        console.warn('[session-restore] Timeout: Baum nicht gerendert.');
        return;
      }
      setTimeout(check, 500);
    }

    check();
  }

  // Los geht's
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
