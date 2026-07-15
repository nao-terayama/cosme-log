/* Cosme log — データ保存(IndexedDB)まわり */
'use strict';

const DB_NAME = 'cosme-log';
const DB_VERSION = 1;

let _db = null;

// データベースを開く(なければ作る)
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        const store = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// リクエストをPromiseに変換する小道具
function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAddProduct(data) {
  const db = await openDB();
  const store = db.transaction('products', 'readwrite').objectStore('products');
  return reqAsPromise(store.add(data)); // 新しいidが返る
}

async function dbPutProduct(data) {
  const db = await openDB();
  const store = db.transaction('products', 'readwrite').objectStore('products');
  return reqAsPromise(store.put(data));
}

async function dbDeleteProduct(id) {
  const db = await openDB();
  const store = db.transaction('products', 'readwrite').objectStore('products');
  return reqAsPromise(store.delete(id));
}

async function dbGetProduct(id) {
  const db = await openDB();
  const store = db.transaction('products', 'readonly').objectStore('products');
  return reqAsPromise(store.get(id));
}

async function dbGetAllProducts() {
  const db = await openDB();
  const store = db.transaction('products', 'readonly').objectStore('products');
  return reqAsPromise(store.getAll());
}

async function dbClearProducts() {
  const db = await openDB();
  const store = db.transaction('products', 'readwrite').objectStore('products');
  return reqAsPromise(store.clear());
}

async function dbGetSetting(key) {
  const db = await openDB();
  const store = db.transaction('settings', 'readonly').objectStore('settings');
  const row = await reqAsPromise(store.get(key));
  return row ? row.value : undefined;
}

async function dbPutSetting(key, value) {
  const db = await openDB();
  const store = db.transaction('settings', 'readwrite').objectStore('settings');
  return reqAsPromise(store.put({ key, value }));
}
