import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePreview as AutoFilePreview } from '@autonomys/auto-design-system';
import {
  OffchainMetadata,
  canDisplayDirectly,
  needsContentParsing,
  processFileData,
  decryptFileData,
} from '@autonomys/auto-dag-data';
import { useNetwork } from '../../../contexts/network';
import { NetworkId as AutoUtilsNetworkId } from '@autonomys/auto-utils';
import {
  EXTERNAL_ROUTES,
  NetworkId as AutoDriveNetworkId,
} from '@auto-drive/ui';
import { sanitizeHTML } from '../../../utils/sanitizeHTML';
import { Api } from '../../../services/api';
const PREVIEW_FETCH_TIMEOUT_MS = 15_000;

const MAX_PREVIEW_SIZE = BigInt(100 * 1024 * 1024); // 100 MB (preview cap)

// Collect a download stream into a single contiguous byte array, bailing out
// promptly if the preview request has been superseded/aborted.
const collectStream = async (
  iterable: AsyncIterable<Buffer>,
  signal: AbortSignal,
): Promise<ArrayBuffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    chunks.push(new Uint8Array(chunk));
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return combined.buffer as ArrayBuffer;
};

// fflate throws FlateError (e.g. "invalid zlib data") when a file is flagged as
// compressed but its stored bytes are actually raw/uncompressed.
const isDecompressionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const name = error instanceof Error ? error.name : '';
  return (
    message.includes('invalid zlib') ||
    message.includes('invalid deflate') ||
    message.includes('invalid block') ||
    name === 'FlateError'
  );
};

// Compressed (non-encrypted) files can't be previewed from the public gateway:
// it serves them with `Content-Encoding: deflate`, which the browser fails to
// decode. Stream them through the backend download API (raw bytes via
// ignoreEncoding=true) and decompress client-side instead. Falls back to the
// raw bytes when the stored data isn't actually compressed despite metadata.
const fetchDecompressedBytes = async (
  api: Api,
  cid: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> => {
  try {
    return await collectStream(await api.downloadObject(cid), signal);
  } catch (error) {
    if (signal.aborted || !isDecompressionError(error)) {
      throw error;
    }
    return collectStream(
      await api.downloadObject(cid, { skipDecryption: true }),
      signal,
    );
  }
};

export const FilePreview = ({ metadata }: { metadata: OffchainMetadata }) => {
  const { network, api } = useNetwork();
  const [isFilePreview, setIsFilePreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDecrypted, setIsDecrypted] = useState(false);
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const safeSetTextContent = useCallback((text: string) => {
    setTextContent(sanitizeHTML(text));
  }, []);

  const networkId = useMemo(() => {
    switch (network.id) {
      case AutoDriveNetworkId.LOCAL:
      case AutoDriveNetworkId.MAINNET:
        return AutoUtilsNetworkId.MAINNET;
      default:
        return AutoUtilsNetworkId.MAINNET;
    }
  }, [network]);

  const gatewayUrl = EXTERNAL_ROUTES.gatewayObjectDownload(metadata.dataCid);

  const isEncrypted = !!metadata.uploadOptions?.encryption;
  const isCompressed = !!metadata.uploadOptions?.compression;

  // The public gateway serves compressed (non-encrypted) files with
  // `Content-Encoding: deflate`. Browsers fail to decode that response
  // (broken <img>/ERR_CONTENT_DECODING_FAILED), so we must not hand the raw
  // gateway URL to the previewer for those files — it would render the broken
  // response instead of the decompressed blob we build below. The "View on
  // gateway" link is hidden along with it since it is broken in-browser too.
  const previewGatewayUrl = isCompressed && !isEncrypted ? null : gatewayUrl;

  const isPreviewable = useMemo(() => {
    if (metadata.type !== 'file') return false;
    if (metadata.totalSize > MAX_PREVIEW_SIZE) return false;
    return canDisplayDirectly(metadata) || needsContentParsing(metadata) || !!metadata.uploadOptions?.encryption;
  }, [metadata]);

  const fetchFile = useCallback(
    async (password?: string) => {
      // Reset error states on every attempt
      setError(null);
      setDecryptionError(null);

      if (!isPreviewable) {
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // If file is encrypted and no password provided, don't fetch
      if (isEncrypted && !password && !isDecrypted) {
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // For non-encrypted, uncompressed files that can be displayed directly,
      // use the gateway URL directly (no fetch needed). Compressed files are
      // excluded here: the gateway returns them with `Content-Encoding: deflate`,
      // which browsers cannot decode, so they take the decompress path below.
      if (!isEncrypted && !isCompressed && canDisplayDirectly(metadata)) {
        setIsFilePreview(true);
        setFile(null);
        setLoading(false);
        return;
      }

      // Cancel any in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Abort the preview fetch if retrieval doesn't complete quickly.
      // Non-cached archived files can take 20+ minutes to reconstruct
      // from DSN — showing a loading spinner that long is worse than
      // showing no preview at all.
      const timeoutId = setTimeout(
        () => controller.abort(),
        PREVIEW_FETCH_TIMEOUT_MS,
      );

      setIsFilePreview(true);
      setLoading(true);

      try {
        // Compressed (non-encrypted) files can't be previewed via the gateway
        // URL: the gateway sets `Content-Encoding: deflate` and the browser
        // fails to decode it. Retrieve + decompress the bytes via the backend
        // download API, then build a blob for the previewer.
        if (!isEncrypted && isCompressed) {
          const bytes = await fetchDecompressedBytes(
            api,
            metadata.dataCid,
            controller.signal,
          );
          clearTimeout(timeoutId);
          if (abortControllerRef.current !== controller) {
            return;
          }

          const blob = await processFileData({
            dataArrayBuffer: bytes,
            name: metadata.name ?? '',
            rawData: '',
            uploadOptions: metadata.uploadOptions ?? {},
            isEncrypted: false,
          });
          setFile(blob);
          if (needsContentParsing(metadata)) {
            safeSetTextContent(await blob.text());
          }
          setLoading(false);
          return;
        }

        const response = await fetch(gatewayUrl, {
          signal: controller.signal,
        });
        if (!response.ok) {
          clearTimeout(timeoutId);
          throw new Error(
            `Failed to fetch file: ${response.status} ${response.statusText}`,
          );
        }
        const blob = await response.blob();
        clearTimeout(timeoutId);
        setFile(blob);
        // For text-based files, also read the content
        if (needsContentParsing(metadata)) {
          const text = await blob.text();
          safeSetTextContent(text);
        }
        // Handle decryption if needed
        if (metadata.uploadOptions?.encryption && password) {
          try {
            const encryptedFileData = {
              dataArrayBuffer: await blob.arrayBuffer(),
              name: metadata.name ?? '',
              rawData: '',
              uploadOptions: metadata.uploadOptions,
              isEncrypted: true,
            };
            const decryptedFileData = await decryptFileData(
              password,
              encryptedFileData,
            );
            const decryptedBlob = await processFileData(decryptedFileData);
            setFile(decryptedBlob);
            setIsDecrypted(true);
            setLoading(false);
            return;
          } catch {
            setDecryptionError('Invalid password or decryption failed');
            setLoading(false);
            return;
          }
        }
        setLoading(false);
      } catch (error) {
        clearTimeout(timeoutId);
        // A newer fetchFile call has superseded this one — don't touch state.
        // This must run regardless of the error type: aborting a superseded
        // request can surface as a decompression/network error rather than an
        // AbortError, because the underlying download is not itself cancelable.
        if (abortControllerRef.current !== controller) {
          return;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Our own timeout fired — hide the preview.
          setIsFilePreview(false);
          setLoading(false);
          return;
        }
        console.error('Error fetching file:', error);
        setError(
          error instanceof Error ? error.message : 'Failed to fetch file',
        );
        setLoading(false);
      }
    },
    [
      metadata,
      isDecrypted,
      isPreviewable,
      isEncrypted,
      isCompressed,
      gatewayUrl,
      api,
      safeSetTextContent,
    ],
  );

  useEffect(() => {
    fetchFile();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchFile]);

  return (
    <AutoFilePreview
      metadata={metadata}
      network={networkId}
      loading={loading}
      file={file}
      error={error}
      isAutoDrive
      decryptionError={decryptionError}
      isFilePreview={isFilePreview}
      textContent={textContent}
      gatewayUrl={previewGatewayUrl}
      handleDecrypt={fetchFile}
    />
  );
};
