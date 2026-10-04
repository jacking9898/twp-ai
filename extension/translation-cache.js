// SPDX-License-Identifier: MPL-2.0
// Separate from credentials and exported preferences. Only hashes and validated
// translations and bounded, public display metadata are persisted; a failed cache
// never fails translation. Original source text and credentials are not stored here.
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
export async function writeCache(key, translations, policy, ticket, metadata = {}) {
  try {
    const info = {};
    for(const field of ['profileId','service','model','context','kind','sourceLanguage','targetLanguage'])if(typeof metadata[field]==='string')info[field]=metadata[field].slice(0,200);
    const bytes = JSON.stringify([translations,info]).length * 2 + 256;
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
        store.put({key, translations, metadata:info, createdAt: Date.now(), bytes});
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
export async function listCache(policy, {query='',offset=0,limit=30} = {}) {
  const rows = (await transaction('readonly',store=>store.getAll())).filter(row=>isFresh(row,policy));
  const search=String(query).trim().toLocaleLowerCase().slice(0,200);
  const matched=rows.filter(row=>!search || [row.metadata?.service,row.metadata?.model,row.metadata?.context,...row.translations].join('\n').toLocaleLowerCase().includes(search)).sort((a,b)=>b.createdAt-a.createdAt);
  const start=Math.max(0,Number(offset)||0), count=Math.max(1,Math.min(50,Number(limit)||30));
  return {total:matched.length,entries:matched.slice(start,start+count).map(row=>({key:row.key,createdAt:row.createdAt,expiresAt:row.createdAt+policy.ttl,bytes:row.bytes,metadata:row.metadata||{},segments:row.translations.length,preview:row.translations.join('\n').slice(0,350)}))};
}
export async function cacheDetail(key,policy) {
  const row=await transaction('readonly',store=>store.get(key));
  if(!isFresh(row,policy))return null;
  return {translations:row.translations,metadata:row.metadata||{}};
}
export async function deleteCache(keys) {
  if(!Array.isArray(keys)||!keys.length||keys.length>1000||keys.some(key=>typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)))throw new Error('请选择有效的缓存记录');
  // Pending writers cannot put a just-deleted result back after deletion.
  epoch++;latest.clear();
  await transaction('readwrite',store=>{for(const key of new Set(keys))store.delete(key);});
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
