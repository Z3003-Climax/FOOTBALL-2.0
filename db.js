// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — db.js
// Couche de persistance IndexedDB
// Remplace localStorage pour contourner le quota 5MB
// API : EQ_DB.get(key) / .set(key,val) / .del(key) / .clear()
// Toutes les méthodes retournent des Promises.
// ═══════════════════════════════════════════════════════════════

'use strict';

const EQ_DB = (() => {

  const DB_NAME    = 'equestria_football';
  const DB_VERSION = 1;
  const STORE      = 'keyval';
  let   _db        = null;

  // ─── OPEN (singleton) ────────────────────────────────────────
  function _open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = e => {
        _db = e.target.result;
        // Si la connexion se ferme (ex: navigateur supprime IDB), on reset
        _db.onclose = () => { _db = null; };
        resolve(_db);
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  // ─── GET ─────────────────────────────────────────────────────
  async function get(key) {
    try {
      const db  = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = e => reject(e.target.error);
      });
    } catch(e) {
      console.warn('[DB] get error:', key, e);
      return null;
    }
  }

  // ─── SET ─────────────────────────────────────────────────────
  async function set(key, value) {
    try {
      const db  = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
      });
    } catch(e) {
      console.error('[DB] set error:', key, e);
    }
  }

  // ─── DEL ─────────────────────────────────────────────────────
  async function del(key) {
    try {
      const db  = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
      });
    } catch(e) {
      console.warn('[DB] del error:', key, e);
    }
  }

  // ─── CLEAR ALL ───────────────────────────────────────────────
  async function clear() {
    try {
      const db  = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).clear();
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
      });
    } catch(e) {
      console.error('[DB] clear error:', e);
    }
  }

  // ─── PRELOAD MULTIPLE KEYS AT ONCE ───────────────────────────
  // Retourne { key: value, ... } pour tous les keys fournis
  async function preload(keys) {
    const results = await Promise.all(keys.map(k => get(k)));
    return Object.fromEntries(keys.map((k, i) => [k, results[i]]));
  }

  return { get, set, del, clear, preload };

})();
