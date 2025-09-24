'use client';

import { handleFileDownload } from 'utils/file';
import { openDatabase } from 'utils/indexedb';
import { bufferToIterable } from 'utils/async';
import { useNetwork } from 'contexts/network';
import { Api } from 'services/api';

export interface DownloadApi {
  fetchFile: (cid: string, password?: string) => Promise<void>;
}

export const createDownloadService = (api: Api) => {
  const fetchFile = async (cid: string, password?: string) => {
    const fileInCache = await hasFileInCache(cid);

    if (fileInCache) {
      return fetchFromCache(cid);
    }

    return fetchFromApi(cid, password);
  };

  const hasFileInCache = async (cid: string) => {
    try {
      const objectStoreName = getObjectStoreName();
      const db = await openDatabase(objectStoreName);

      const transaction = db.transaction(objectStoreName, 'readonly');

      const store = transaction.objectStore(objectStoreName);

      const request = store.count(cid);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => reject('Error checking cache');
      });
    } catch (error) {
      console.warn('Cache check failed:', error);
      return false;
    }
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
    try {
      const objectStoreName = getObjectStoreName();
      const db = await openDatabase(objectStoreName);
      const transaction = db.transaction(objectStoreName, 'readwrite');
      const store = transaction.objectStore(objectStoreName);
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
    } catch (error) {
      console.warn('Saving to cache failed:', error);
    }
  };

  const MB = 1024 * 1024;
  const MAX_CACHEABLE_FILE_SIZE = 150 * MB;

  const getObjectStoreName = () => {
    const objectStoreVersion =
      process.env.NEXT_PUBLIC_OBJECT_STORE_VERSION ?? 'v1';
    return `files-${objectStoreVersion}`;
  };

  const fetchFromApi = async (cid: string, password?: string) => {
    const { metadata } = await api.fetchUploadedObjectMetadata(cid);

    const StreamSaver = await import('streamsaver');

    let download = await api.downloadObject(metadata.dataCid, password);

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
    try {
      const objectStoreName = getObjectStoreName();
      const db = await openDatabase(objectStoreName);
      const transaction = db.transaction(objectStoreName, 'readonly');
      const store = transaction.objectStore(objectStoreName);
      const request = store.get(cid);

      const buffer = await new Promise<Buffer>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result.buffer);
        request.onerror = () => reject('Error fetching file from cache');
      });

      const { metadata } = await api.fetchUploadedObjectMetadata(cid);

      const StreamSaver = await import('streamsaver');

      // Create a writable stream using StreamSaver
      const fileStream = StreamSaver.createWriteStream(
        metadata.type === 'file' ? metadata.name! : `${metadata.name!}.zip`,
        { size: Number(metadata.totalSize) },
      );
      const writer = fileStream.getWriter();
      writer.write(Buffer.alloc(0));

      await handleFileDownload(bufferToIterable(buffer), writer);
    } catch (error) {
      console.error('Fetching from cache failed:', error);
      // Fall back to API fetch
      await fetchFromApi(cid);
    }
  };

  return {
    fetchFile,
  };
};

export const useDownloadService = () => {
  const network = useNetwork();

  if (!network) {
    throw new Error('Network not found');
  }

  return createDownloadService(network.api);
};
