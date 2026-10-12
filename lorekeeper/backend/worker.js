/* Cloudflare Worker: guarda los baúles en un espacio KV llamado LK_VAULTS.
   Despliegue en README.md. */
import { handle } from './core.js';

export default {
  async fetch(request, env) {
    const store = {
      get: (k) => env.LK_VAULTS.get(k),
      put: (k, v) => env.LK_VAULTS.put(k, v),
      delete: (k) => env.LK_VAULTS.delete(k),
    };
    return handle(request, store, env);
  },
};
