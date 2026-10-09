export const shortenString = (
  str?: string | null,
  length: number = 20,
): string => {
  if (!str) return '';
  if (length <= 0) return '';
  if (str.length <= length) return str;
  const half = Math.floor(length / 2);
  return str.slice(0, half) + '...' + str.slice(-half);
};

export const isValidUUID = (uuid?: string | null): boolean => {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex =
    /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
  return uuidRegex.test(uuid);
};

export const simpleMimeType = (mimeType?: string | null): string => {
  if (!mimeType || typeof mimeType !== 'string') return '';
  return mimeType.split('/')[0] ?? '';
};
