export const shortenHandle = (handle: string) => {
  if (handle.length <= 16) return handle;
  return handle.slice(0, 6) + "..." + handle.slice(-6);
};
