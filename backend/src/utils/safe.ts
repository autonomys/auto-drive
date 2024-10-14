export const safeCallback =
  <A extends any[], R>(
    callback: (...args: A) => R
  ): ((...args: A) => R | undefined) =>
  (...args: A) => {
    try {
      return callback(...args);
    } catch (error) {
      console.error(error);
    }
  };

export const safeDownloadFilename = (filename?: string) => {
  return filename
    ? filename
        .replace(/[\x00-\x1F\x7F]/g, "")
        .replace(/[()<>@,;:\\"\/\[\]?={} \t]/g, "_")
    : "download";
};
