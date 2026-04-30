/**
 * session-restore.js — S+L Explorer Session-Restore Modul
 *
 * Speichert den Explorer-Zustand (angehakte Ordner, aufgeklappte Nodes,
 * Dateiart-Filter, Suchfeld) periodisch in sessionStorage.
 * Nach einem Reload wird der Zustand automatisch wiederhergestellt.
 *
 * Einbindung:
 *   <script src="session-restore.js"></script>
 *
 * Das Script muss NACH index.html geladen werden, damit die globalen
 * Variablen und Funktionen (projectId, toggleTreeNode, checkTreeNode, etc.)
 * verfügbar sind.
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
    // Angehakte Ordner (DOM-basiert)
    var checkedFolders = [];
    document.querySelectorAll('.tree-row.checked').forEach(function (row) {
      var node = row.closest('.tree-node');
      if (node && node.dataset.id) {
        checkedFolders.push(node.dataset.id);
      }
    });

    // Aufgeklappte Baum-Nodes
    var openNodes = [];
    document.querySelectorAll('.tree-node.open').forEach(function (node) {
      if (node.dataset.id) {
        openNodes.push(node.dataset.id);
      }
    });

    // Dateiart-Filter
    var activeTypes = {};
    document.querySelectorAll('.type-filter-cb').forEach(function (cb) {
      if (cb.dataset.ext) {
        activeTypes[cb.dataset.ext] = !!cb.checked;
      }
    });

    // Suchfeld
    var searchInput = document.getElementById('searchInput');
    var searchText = searchInput ? searchInput.value : '';

    return {
      projectId: typeof projectId !== 'undefined' ? projectId : null,
      timestamp: Date.now(),
      checkedFolders: checkedFolders,
      openNodes: openNodes,
      activeTypes: activeTypes,
      searchText: searchText
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
      if (typeof projectId !== 'undefined' && state.projectId !== projectId) {
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

  /**
   * Stellt den gespeicherten Zustand wieder her.
   * Muss aufgerufen werden NACHDEM der Baum gerendert ist.
   */
  function restoreState(state) {
    console.log('[session-restore] Stelle Zustand wieder her...');
    console.log('[session-restore] Checked:', state.checkedFolders.length,
      '| Open:', state.openNodes.length);

    // Gespeicherten Zustand verbrauchen
    sessionStorage.removeItem(STORAGE_KEY);

    // --- a) Baum aufklappen (sequentiell, damit Eltern vor Kindern geladen) ---
    // toggleTreeNode klappt lazy Unterordner auf, daher müssen wir warten
    // bis jeder Node gerendert ist, bevor wir den nächsten aufklappen.
    var openQueue = state.openNodes.slice();

    function openNext() {
      if (openQueue.length === 0) {
        // Alle Nodes aufgeklappt → jetzt Ordner anhaken
        restoreChecked(state);
        return;
      }

      var id = openQueue.shift();
      var node = document.querySelector('.tree-node[data-id="' + id + '"]');

      if (node) {
        // Nur aufklappen wenn noch nicht offen
        if (!node.classList.contains('open')) {
          if (typeof toggleTreeNode === 'function') {
            toggleTreeNode(id);
          }
        }
        // Kurz warten damit lazy-loading abgeschlossen werden kann
        setTimeout(openNext, 150);
      } else {
        // Node nicht gefunden (evtl. noch nicht geladen) → überspringen
        console.warn('[session-restore] Node nicht gefunden:', id);
        setTimeout(openNext, 50);
      }
    }

    openNext();
  }

  function restoreChecked(state) {
    // --- b) Ordner anhaken ---
    var checkQueue = state.checkedFolders.slice();

    function checkNext() {
      if (checkQueue.length === 0) {
        // Alle Ordner angehakt → Filter + Suche wiederherstellen
        restoreFiltersAndSearch(state);
        return;
      }

      var id = checkQueue.shift();
      var node = document.querySelector('.tree-node[data-id="' + id + '"]');

      if (node) {
        var row = node.querySelector('.tree-row');
        // Nur anhaken wenn noch nicht checked
        if (row && !row.classList.contains('checked')) {
          if (typeof checkTreeNode === 'function') {
            checkTreeNode(id);
          }
        }
        // loadFiles() wird durch checkTreeNode getriggert → kurz warten
        setTimeout(checkNext, 300);
      } else {
        console.warn('[session-restore] Checked-Node nicht gefunden:', id);
        setTimeout(checkNext, 50);
      }
    }

    checkNext();
  }

  function restoreFiltersAndSearch(state) {
    // --- c) Dateiart-Filter setzen ---
    if (state.activeTypes && Object.keys(state.activeTypes).length > 0) {
      document.querySelectorAll('.type-filter-cb').forEach(function (cb) {
        if (cb.dataset.ext && state.activeTypes.hasOwnProperty(cb.dataset.ext)) {
          cb.checked = state.activeTypes[cb.dataset.ext];
        }
      });

      // activeFileTypes-Objekt synchronisieren (falls es global existiert)
      if (typeof activeFileTypes !== 'undefined') {
        Object.keys(state.activeTypes).forEach(function (ext) {
          if (state.activeTypes[ext]) {
            activeFileTypes[ext] = true;
          } else {
            delete activeFileTypes[ext];
          }
        });
      }
    }

    // --- d) Suchfeld wiederherstellen ---
    if (state.searchText) {
      var searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = state.searchText;
        // filterTable aufrufen um die Suche anzuwenden
        if (typeof filterTable === 'function') {
          setTimeout(function () {
            filterTable();
          }, 500);
        }
      }
    }

    console.log('[session-restore] Wiederherstellung abgeschlossen.');
  }

  // =========================================================================
  // 5. Banner-Reload erweitern
  // =========================================================================

  /**
   * Patcht den Session-Banner Reload-Button, damit vor dem Reload
   * der Zustand gespeichert wird.
   */
  function patchReloadButton() {
    // MutationObserver: Banner kann dynamisch eingefügt werden
    var observer = new MutationObserver(function () {
      // Suche nach dem Reload-Button im Session-Banner
      var btn = document.querySelector('#session-expired-banner button') ||
        document.querySelector('.session-banner button') ||
        document.querySelector('[data-session-reload]');

      if (!btn || btn._sessionRestorePatched) return;

      btn._sessionRestorePatched = true;
      var originalOnClick = btn.onclick;

      btn.addEventListener('click', function (e) {
        // Zustand sofort speichern BEVOR der Reload passiert
        saveState();
        console.log('[session-restore] Zustand vor Reload gespeichert.');
      }, true); // capture phase → läuft VOR anderen Handlern

      console.log('[session-restore] Reload-Button gepatcht.');
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Auch vorhandene Buttons sofort prüfen
    setTimeout(function () {
      observer.disconnect(); // Re-trigger einmal
      observer.observe(document.body, { childList: true, subtree: true });
    }, 2000);
  }

  // =========================================================================
  // 6. Globale Funktion für manuelles Speichern (z.B. aus viewer-v13.js)
  // =========================================================================

  /**
   * Kann von anderen Modulen aufgerufen werden:
   *   window.slSessionRestore.saveNow()
   */
  window.slSessionRestore = {
    saveNow: saveState,
    collectState: collectState
  };

  // =========================================================================
  // 7. Initialisierung
  // =========================================================================

  function init() {
    console.log('[session-restore] Modul geladen.');

    // Periodisches Speichern starten
    setInterval(saveState, SAVE_INTERVAL_MS);

    // Banner-Reload-Button patchen
    patchReloadButton();

    // Vor Unload ebenfalls speichern (Fallback)
    window.addEventListener('beforeunload', function () {
      saveState();
    });

    // Auf Wiederherstellung warten: rootFolderId muss gesetzt sein
    waitForReady(function () {
      var state = loadSavedState();
      if (state) {
        console.log('[session-restore] Gespeicherten Zustand gefunden von',
          new Date(state.timestamp).toLocaleTimeString());
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
   * Wartet darauf, dass rootFolderId gesetzt ist (Extension ist initialisiert).
   */
  function waitForReady(callback) {
    var attempts = 0;
    var maxAttempts = 60; // max 30 Sekunden

    function check() {
      attempts++;
      if (typeof rootFolderId !== 'undefined' && rootFolderId) {
        callback();
        return;
      }
      if (attempts >= maxAttempts) {
        console.warn('[session-restore] Timeout: rootFolderId nicht verfügbar.');
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
        callback();
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
