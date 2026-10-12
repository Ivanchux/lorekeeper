/* ==========================================================
   SINCRONIZACIÓN OPCIONAL  (LK.sync)
   Mantiene tus datos iguales en varios dispositivos usando un
   servidor propio (backend/, Cloudflare Worker o Node).

   - La app sigue siendo "local primero": sin servidor funciona igual.
   - Los datos se CIFRAN en el móvil (AES-GCM) con una clave sacada de
     tu código. El servidor solo ve texto ilegible y un hash.
   - Fusión por registros: cada libro/sesión/cita se compara por su
     fecha de modificación; los borrados se recuerdan ("lápidas").
   - Control de versiones optimista (If-Match): si dos dispositivos
     guardan a la vez, el segundo descarga, fusiona y vuelve a subir.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const KEY = 'lk-sync';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I

  let cfg = null; // { url, code, rev, dirty, lastSync, lastError }
  let state = 'off'; // off | idle | syncing | error | offline
  let running = false;
  let again = false;
  let changeCounter = 0;
  let lastRun = 0;
  const listeners = new Set();

  const loadCfg = () => {
    try {
      cfg = JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      cfg = null;
    }
    return cfg;
  };
  const saveCfg = () => {
    try {
      cfg ? localStorage.setItem(KEY, JSON.stringify(cfg)) : localStorage.removeItem(KEY);
    } catch {}
  };
  const setState = (s, err) => {
    state = s;
    if (cfg) cfg.lastError = err || null;
    listeners.forEach((fn) => fn(info()));
  };
  const info = () => ({ state, on: !!cfg, url: cfg?.url || '', lastSync: cfg?.lastSync || null, error: cfg?.lastError || null });

  /* ---------------- Códigos y cifrado ---------------- */

  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function genCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
    return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
  }

  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder();
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  /** Lo que se manda al servidor para identificarse (no sirve para descifrar). */
  const tokenFor = async (code) => toHex(await crypto.subtle.digest('SHA-256', enc.encode('lk-auth:' + normCode(code))));

  async function keyFor(code) {
    const base = await crypto.subtle.importKey('raw', enc.encode('lk-enc:' + normCode(code)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('lorekeeper-sync-v1'), iterations: 120000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  let keyCache = { code: null, key: null };
  const getKey = async (code) => {
    if (keyCache.code !== code) keyCache = { code, key: await keyFor(code) };
    return keyCache.key;
  };

  async function encrypt(obj, code) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(code), enc.encode(JSON.stringify(obj))));
    const all = new Uint8Array(12 + ct.length);
    all.set(iv);
    all.set(ct, 12);
    return 'lk1.' + b64(all);
  }

  async function decrypt(text, code) {
    if (!String(text).startsWith('lk1.')) throw new Error('Formato de copia desconocido.');
    const all = unb64(text.slice(4));
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await getKey(code), all.slice(12));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('No se pudo descifrar: el código no corresponde a esta copia.');
    }
  }

  /* ---------------- Fusión ---------------- */

  /** Fusiona dos copias completas. Gana el registro modificado más tarde. */
  function merge(a, b) {
    const tombstones = { ...(a.tombstones || {}) };
    for (const [id, ts] of Object.entries(b.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, ts);

    const union = (xs = [], ys = [], stamp) => {
      const map = new Map();
      for (const item of [...xs, ...ys]) {
        const cur = map.get(item.id);
        if (!cur || stamp(item) > stamp(cur)) map.set(item.id, item);
      }
      // Un borrado posterior a la última modificación gana
      return [...map.values()].filter((item) => !(tombstones[item.id] && tombstones[item.id] >= stamp(item)));
    };

    const books = union(a.books, b.books, (x) => x.updatedAt || 0);
    const alive = new Set(books.map((x) => x.id));
    const sessions = union(a.sessions, b.sessions, (x) => x.createdAt || 0).filter((s) => alive.has(s.bookId));
    const quotes = union(a.quotes, b.quotes, (x) => x.createdAt || 0).filter((q) => alive.has(q.bookId));

    const pa = a.profile || {};
    const pb = b.profile || {};
    const newer = (pa.updatedAt || 0) >= (pb.updatedAt || 0) ? pa : pb;
    const seen = pa.achSeen || pb.achSeen ? [...new Set([...(pa.achSeen || []), ...(pb.achSeen || [])])] : null;
    const profile = { ...pb, ...pa, ...newer, achSeen: seen, id: 'profile' };

    return { app: 'lorekeeper', schema: Math.max(a.schema || 0, b.schema || 0), exportedAt: new Date().toISOString(), profile, books, sessions, quotes, tombstones };
  }

  /** Huella para saber si dos copias son equivalentes. */
  function signature(d) {
    const ids = (list, f) => (list || []).map((x) => `${x.id}:${f(x)}`).sort().join(',');
    return [
      ids(d.books, (x) => x.updatedAt || 0),
      ids(d.sessions, (x) => x.createdAt || 0),
      ids(d.quotes, (x) => x.createdAt || 0),
      d.profile?.updatedAt || 0,
      JSON.stringify(d.profile?.achSeen || null),
      Object.keys(d.tombstones || {}).sort().join(','),
    ].join('|');
  }

  /* ---------------- Red ---------------- */

  const cleanUrl = (url) => {
    let s = String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|192\.168\.|10\.)/.test(s) ? 'http://' : 'https://') + s;
    return s;
  };

  async function api(method, path, { url = cfg?.url, code = cfg?.code, headers = {}, body, rawToken } = {}) {
    const h = { ...headers };
    if (rawToken !== false) h.Authorization = 'Bearer ' + (rawToken || (await tokenFor(code)));
    if (body) h['Content-Type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(url + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    } catch (e) {
      const err = new Error(
        location.protocol === 'https:' && url.startsWith('http:')
          ? 'Esta app va por https y el servidor por http: el navegador lo bloquea. Usa un servidor con https.'
          : navigator.onLine === false
            ? 'Sin conexión.'
            : 'No se pudo conectar con el servidor.'
      );
      err.offline = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Error ${res.status} del servidor`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  /* ---------------- Sincronizar ---------------- */

  async function syncNow() {
    if (!cfg) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    setState('syncing');
    const startedAt = changeCounter;
    let changedLocal = false;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const meta = await api('GET', '/api/vault?meta=1');
        const local = await LK.db.exportAll();

        if (meta.rev === cfg.rev && !cfg.dirty) break; // ya estaba al día

        let target = local;
        let remoteSig = null;
        if (!meta.empty && meta.rev !== cfg.rev) {
          const rem = await api('GET', '/api/vault');
          const remote = await decrypt(rem.data, cfg.code);
          remoteSig = signature(remote);
          target = merge(local, remote);
        } else if (!meta.empty) {
          const rem = await api('GET', '/api/vault');
          remoteSig = signature(await decrypt(rem.data, cfg.code));
        }

        if (signature(target) !== signature(local)) {
          await LK.db.importAll(target, { silent: true });
          changedLocal = true;
        }

        if (remoteSig !== null && remoteSig === signature(target)) {
          cfg.rev = meta.rev;
          if (changeCounter === startedAt) cfg.dirty = false;
          break; // el servidor ya tiene lo mismo
        }

        try {
          const put = await api('PUT', '/api/vault', { headers: { 'If-Match': String(meta.rev) }, body: { data: await encrypt(target, cfg.code) } });
          cfg.rev = put.rev;
          if (changeCounter === startedAt) cfg.dirty = false;
          break;
        } catch (e) {
          if (e.status === 409 && attempt < 3) continue; // otro dispositivo guardó antes: repetir
          throw e;
        }
      }
      cfg.lastSync = Date.now();
      saveCfg();
      setState('idle');
      if (changedLocal) LK.app?.refresh();
    } catch (e) {
      saveCfg();
      setState(e.offline ? 'offline' : 'error', e.message);
    } finally {
      running = false;
      lastRun = Date.now();
      if (again) {
        again = false;
        setTimeout(syncNow, 500);
      }
    }
  }

  const debounced = u.debounce(syncNow, 6000);

  /* ---------------- Conectar / desconectar ---------------- */

  function requireCrypto() {
    if (!crypto?.subtle) throw new Error('Este navegador no permite cifrar aquí. Abre la app por https.');
  }

  /** Crea una cuenta nueva en el servidor. Devuelve el código a guardar. */
  async function create(url, password = '') {
    requireCrypto();
    url = cleanUrl(url);
    const code = genCode();
    const headers = password ? { 'X-Create-Password': password } : {};
    await api('POST', '/api/vaults', { url, headers, rawToken: false, body: { token: await tokenFor(code) } });
    cfg = { url, code: normCode(code), rev: 0, dirty: true, lastSync: null, lastError: null };
    saveCfg();
    setState('idle');
    await syncNow();
    return code;
  }

  /** Conecta este dispositivo con un código existente. Fusiona con lo que ya hay aquí. */
  async function connect(url, code) {
    requireCrypto();
    url = cleanUrl(url);
    code = normCode(code);
    if (code.length < 16) throw new Error('El código es demasiado corto.');
    await api('GET', '/api/vault?meta=1', { url, code }); // lanza 404/401 si no existe
    cfg = { url, code, rev: -1, dirty: true, lastSync: null, lastError: null };
    saveCfg();
    setState('idle');
    await syncNow();
    if (state === 'error' || state === 'offline') {
      const msg = cfg.lastError;
      cfg = null;
      saveCfg();
      setState('off');
      throw new Error(msg);
    }
  }

  function disconnect() {
    cfg = null;
    saveCfg();
    setState('off');
  }

  const displayCode = () => (cfg ? cfg.code.replace(/(.{4})(?=.)/g, '$1-') : '');
  const linkFor = () => `${location.origin}${location.pathname}#/enlazar/${encodeURIComponent(cfg.url)}/${cfg.code}`;

  /* ---------------- Arranque ---------------- */

  function init() {
    loadCfg();
    state = cfg ? 'idle' : 'off';
    LK.db.onChange(() => {
      changeCounter++;
      if (!cfg) return;
      cfg.dirty = true;
      saveCfg();
      debounced();
    });
    if (cfg) setTimeout(syncNow, 1500);
    window.addEventListener('online', () => cfg && syncNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && cfg && Date.now() - lastRun > 20000) syncNow();
    });
    setInterval(() => cfg && document.visibilityState === 'visible' && syncNow(), 5 * 60 * 1000);
  }

  LK.sync = {
    init,
    create,
    connect,
    disconnect,
    syncNow,
    merge,
    signature,
    genCode,
    normCode,
    displayCode,
    linkFor,
    cleanUrl,
    info,
    isOn: () => !!cfg,
    onStatus: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})(window.LK);
