import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePreview as AutoFilePreview } from '@autonomys/auto-design-system';
import {
  OffchainMetadata,
  canDisplayDirectly,
  needsContentParsing,
  processFileData,
} from '@autonomys/auto-dag-data';
import { useNetwork } from '../../../contexts/network';
import { NetworkId as AutoUtilsNetworkId } from '@autonomys/auto-utils';
import {
  EXTERNAL_ROUTES,
  NetworkId as AutoDriveNetworkId,
} from '@auto-drive/ui';
import { sanitizeHTML } from '../../../utils/sanitizeHTML';
import { loadPlaintextBytes } from './decode';

const PREVIEW_FETCH_TIMEOUT_MS = 15_000;

const MAX_PREVIEW_SIZE = BigInt(100 * 1024 * 1024); // 100 MB (preview cap)

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

  // Reset all preview state when the previewed object changes. The component is
  // reused (not remounted) when navigating between files, so without this a
  // stale decrypted blob — and a stale `isDecrypted` flag — would carry over to
  // the next file. In particular `isDecrypted` left as `true` makes the
  // no-password branch of `fetchFile` bail out early and render the previous
  // file's decrypted content under the new file's metadata. Done during render
  // (the React "adjust state on prop change" pattern) so the reset is visible to
  // the `fetchFile` invocation triggered by the same metadata change.
  const previewedCidRef = useRef(metadata.dataCid);
  if (previewedCidRef.current !== metadata.dataCid) {
    previewedCidRef.current = metadata.dataCid;
    abortControllerRef.current?.abort();
    setIsFilePreview(false);
    setLoading(true);
    setError(null);
    setDecryptionError(null);
    setIsDecrypted(false);
    setFile(null);
    setTextContent(null);
  }

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

      // Encrypted files need a password before we can fetch + decrypt.
      if (isEncrypted && !password) {
        // Already decrypted: a state update (e.g. setIsDecrypted(true)) re-ran
        // this effect with no password. Keep the existing decrypted preview
        // rather than re-fetching, which would throw for lack of a password
        // and surface a bogus "invalid password" error over a working preview.
        if (isDecrypted) {
          return;
        }
        // No password yet — show the password prompt instead of a preview.
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // Fast path: plain, directly-renderable media. Let the browser stream it
      // straight from the gateway URL (native range support, nothing buffered
      // into JS memory). Safe because uncompressed files carry no
      // `Content-Encoding`, so the gateway cannot mislabel the body.
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
        // Everything that can't be rendered straight from a URL (compressed,
        // encrypted, or text we need to read into memory) goes through one
        // defensive path: fetch the raw stored bytes once and decode them
        // client-side, independent of the gateway's wire encoding.
        const bytes = await loadPlaintextBytes(
          api,
          metadata,
          password,
          controller.signal,
        );
        clearTimeout(timeoutId);
        // A newer fetchFile call has superseded this one — don't touch state.
        if (abortControllerRef.current !== controller) {
          return;
        }

        const blob = await processFileData({
          dataArrayBuffer: bytes.buffer as ArrayBuffer,
          name: metadata.name ?? '',
          rawData: '',
          uploadOptions: metadata.uploadOptions ?? {},
          isEncrypted: false,
        });
        setFile(blob);
        if (isEncrypted) {
          setIsDecrypted(true);
        }
        if (needsContentParsing(metadata)) {
          safeSetTextContent(await blob.text());
        }
        setLoading(false);
      } catch (error) {
        clearTimeout(timeoutId);
        // A newer fetchFile call has superseded this one — don't touch state.
        // This must run regardless of the error type: aborting a superseded
        // request can surface as a decode/network error rather than an
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
        // Encrypted files surface a dedicated message + inline password retry,
        // since the most likely failure here is a wrong password.
        if (isEncrypted) {
          setDecryptionError('Invalid password or decryption failed');
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
