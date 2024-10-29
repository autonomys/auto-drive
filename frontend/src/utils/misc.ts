export const shortenString = (str: string, length: number) => {
  if (str.length <= length) return str;
  return str.slice(0, length / 2) + "..." + str.slice(-length / 2);
};

export const isValidUUID = (uuid: string | null) => {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid ? uuidRegex.test(uuid) : false;
};
