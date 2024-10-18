export const shortenHandle = (handle: string) => {
  if (handle.length <= 16) return handle;
  return handle.slice(0, 6) + "..." + handle.slice(-6);
};

export const shortenString = (str: string, length: number) => {
  if (str.length <= length) return str;
  return str.slice(0, length / 2) + "..." + str.slice(-length / 2);
};
