/**
 * Answer cache — in memory, mirrored to disk.
 *
 * Asking a local 8B for the same sentence twice costs another several seconds for a
 * byte-identical answer. Students repeat themselves constantly — retyping a sentence
 * after switching teacher, comparing formal against casual, demoing the thing to
 * someone — so the second ask should be instant.
 *
 * The disk mirror matters in development: `next dev` throws module state away every
 * time a file changes, which would empty a purely in-memory cache several times an
 * hour. Writes are debounced and every filesystem call is optional — if the path
 * isn't writable the cache simply stops persisting.
 *
 * Deliberately not a real LRU: an ordered Map with the oldest key dropped is enough
 * for ~80 entries.
 */

import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 80;
const store = new Map();

/** Set AI_TEACHER_CACHE_FILE="" to keep the cache in memory only. */
const FILE =
  process.env.AI_TEACHER_CACHE_FILE === undefined
    ? path.join(process.cwd(), ".cache", "ai-teacher-answers.json")
    : process.env.AI_TEACHER_CACHE_FILE || null;

let loaded = false;
let writeTimer = null;

function load() {
  loaded = true;
  if (!FILE) return;
  try {
    const entries = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(entries)) {
      for (const [key, value] of entries.slice(-MAX_ENTRIES)) store.set(key, value);
    }
  } catch {
    // No cache file yet, or it is unreadable/corrupt. Either way: start empty.
  }
}

function persist() {
  if (!FILE || writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify([...store.entries()]));
    } catch {
      // Read-only checkout, full disk — not worth failing a request over.
    }
  }, 500);
  // Never hold the process open just to flush a cache.
  writeTimer.unref?.();
}

export function cacheKey({ languageCode, speechId, question }) {
  return `${languageCode}|${speechId}|${String(question || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export function getCached(key) {
  if (!loaded) load();
  if (!store.has(key)) return undefined;
  const value = store.get(key);
  // Re-insert so the busiest entries are the last to be evicted.
  store.delete(key);
  store.set(key, value);
  return value;
}

export function setCached(key, value) {
  if (!loaded) load();
  store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
  persist();
  return value;
}

export function clearCache() {
  loaded = true;
  store.clear();
}

export const cacheSize = () => store.size;

/** Where the mirror lives, or null when persistence is off. Used by the verifier. */
export const cacheFile = () => FILE;
