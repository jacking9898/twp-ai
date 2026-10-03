// SPDX-License-Identifier: MPL-2.0
// Separate from credentials and exported preferences. Only hashes and validated
// translations are persisted; a failed/quota-limited cache never fails translation.
const MAX_ENTRIES = 1000, MAX_BYTES = 20 * 1024 * 1024;
let database, epoch = 0, sequence = 0;
const latest = new Map();
export function cachePolicy(value = {}) {
  return {enabled: value.enabled !== false, ttl: Math.max(1, Math.min(8760, Number(value.ttlHours) || 168)) * 3600000};
}
export function isFresh(row, policy, now = Date.now()) {
  return policy.enabled && row && row.createdAt <= now && now - row.createdAt < policy.ttl;
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("TWP_AI_CACHE", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("translations", {keyPath: "key"});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
async function transaction(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("translations", mode);
    const request = action(tx.objectStore("translations"));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export function beginWrite(key) {
  const ticket = {epoch, sequence: ++sequence};
  latest.set(key, ticket);
  return ticket;
}
export function finishWrite(key, ticket) { if (latest.get(key) === ticket) latest.delete(key); }
export async function readCache(key, policy) {
  if (!policy.enabled) return null;
  try {
    const row = await transaction("readwrite", store => {
      const request = store.get(key);
      request.onsuccess = () => { if (request.result && !isFresh(request.result, policy)) store.delete(key); };
      return request;
    });
    if (isFresh(row, policy)) return row.translations;
  } catch { /* Caching is optional. */ }
  return null;
}
export async function writeCache(key, translations, policy, ticket) {
  try {
    const bytes = JSON.stringify(translations).length * 2 + 256;
    if (!policy.enabled || bytes > MAX_BYTES || epoch !== ticket.epoch || latest.get(key) !== ticket) return;
    await transaction("readwrite", store => {
      if (epoch !== ticket.epoch || latest.get(key) !== ticket) return;
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = request.result.filter(row => row.key !== key).sort((a,b) => b.createdAt - a.createdAt);
        let size = bytes, count = 1;
        for (const row of rows) {
          if (!isFresh(row, policy) || count >= MAX_ENTRIES || size + row.bytes > MAX_BYTES) store.delete(row.key);
          else { size += row.bytes; count++; }
        }
        store.put({key, translations, createdAt: Date.now(), bytes});
      };
    });
  } catch { /* Quota errors must not discard the translation. */ }
  finally { if (latest.get(key) === ticket) latest.delete(key); }
}
export async function clearCache() {
  epoch++; latest.clear();
  // Surface failure to the settings UI instead of claiming deletion succeeded.
  await transaction("readwrite", store => store.clear());
}
export async function pruneCache(policy) {
  epoch++; latest.clear();
  try {
    await transaction("readwrite", store => {
      const request = store.getAll();
      request.onsuccess = () => request.result.forEach(row => { if (!isFresh(row, policy)) store.delete(row.key); });
    });
  } catch { /* Read/write remains available if storage recovers. */ }
}
export async function cacheStats(policy) {
  const rows = await transaction("readonly", store => store.getAll());
  const fresh = rows.filter(row => isFresh(row, policy));
  return {count: fresh.length, bytes: fresh.reduce((sum, row) => sum + row.bytes, 0)};
}
