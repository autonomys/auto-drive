import { handleFileDownload } from '../utils/file';
import { openDatabase } from '../utils/indexedb';
import { bufferToIterable } from '../utils/async';
import { ApiService } from './api';

export const fetchFile = async (cid: string, password?: string) => {
  const fileInCache = await hasFileInCache(cid);

  if (fileInCache) {
    console.log('Fetching file from cache', cid);
    return fetchFromCache(cid);
  }

  return fetchFromApi(cid, password);
};

const hasFileInCache = async (cid: string) => {
  const db = await openDatabase();

  const transaction = db.transaction('files', 'readonly');

  const store = transaction.objectStore('files');

  const request = store.count(cid);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result > 0);
    request.onerror = () => reject('Error checking cache');
  });
};

const addFileToCache = async function* (
  file: AsyncIterable<Buffer>,
  promiseResolvers: {
    resolve: (data: Buffer) => void;
  },
): AsyncIterable<Buffer> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of file) {
    buffer = Buffer.concat([buffer, chunk]);
    yield chunk;
  }
  promiseResolvers.resolve(buffer);
};

const saveFileToCache = async (cid: string, buffer: Buffer) => {
  const db = await openDatabase();
  const transaction = db.transaction('files', 'readwrite');
  const store = transaction.objectStore('files');
  store.put({ cid, buffer });

  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject('Error saving file to cache');
    };
  });
};

const MB = 1024 * 1024;
const MAX_CACHEABLE_FILE_SIZE = 150 * MB;

const fetchFromApi = async (cid: string, password?: string) => {
  const { metadata } = await ApiService.fetchUploadedObjectMetadata(cid);

  const StreamSaver = await import('streamsaver');

  let download = await ApiService.downloadObject(metadata.dataCid, password);

  if (metadata.totalSize < MAX_CACHEABLE_FILE_SIZE) {
    new Promise<Buffer>((resolve) => {
      download = addFileToCache(download, { resolve });
    }).then((buffer) => saveFileToCache(cid, buffer));
  }

  // Create a writable stream using StreamSaver
  const fileStream = StreamSaver.createWriteStream(
    metadata.type === 'file' ? metadata.name! : `${metadata.name!}.zip`,
    { size: Number(metadata.totalSize) },
  );
  const writer = fileStream.getWriter();
  writer.write(Buffer.alloc(0));

  await handleFileDownload(download, writer);
};

const fetchFromCache = async (cid: string) => {
  const db = await openDatabase();
  const transaction = db.transaction('files', 'readonly');
  const store = transaction.objectStore('files');
  const request = store.get(cid);

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result.buffer);
    request.onerror = () => reject('Error fetching file from cache');
  });

  const { metadata } = await ApiService.fetchUploadedObjectMetadata(cid);

  const StreamSaver = await import('streamsaver');

  // Create a writable stream using StreamSaver
  const fileStream = StreamSaver.createWriteStream(
    metadata.type === 'file' ? metadata.name! : `${metadata.name!}.zip`,
    { size: Number(metadata.totalSize) },
  );
  const writer = fileStream.getWriter();
  writer.write(Buffer.alloc(0));

  await handleFileDownload(bufferToIterable(buffer), writer);
};
