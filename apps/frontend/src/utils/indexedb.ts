export const openDatabase = (storeName: string) => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Check if running in a browser environment
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      reject('IndexedDB is not available in this environment');
      return;
    }

    const dbRequest = indexedDB.open('file-cache', 1);
    dbRequest.onsuccess = () => resolve(dbRequest.result);
    dbRequest.onerror = () => reject('Error opening database');
    dbRequest.onupgradeneeded = () => {
      const db = dbRequest.result;
      db.createObjectStore(storeName, {
        keyPath: 'cid',
      });
    };
  });
};
