export const currentYear = () => {
  return new Date().getFullYear();
};

export const formatDate = (date: string) => {
  const localLocale =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'en-US';
  return new Date(date).toLocaleDateString(localLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
};
