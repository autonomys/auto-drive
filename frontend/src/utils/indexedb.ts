export const openDatabase = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const dbRequest = indexedDB.open('file-cache', 1);
    dbRequest.onsuccess = () => resolve(dbRequest.result);
    dbRequest.onerror = () => reject('Error opening database');
    dbRequest.onupgradeneeded = () => {
      const db = dbRequest.result;
      db.createObjectStore('files', {
        keyPath: 'cid',
      });
    };
  });
};
