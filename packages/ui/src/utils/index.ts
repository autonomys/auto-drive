export const cn = (...classes: (string | undefined | null)[]) => {
  return classes.filter(Boolean).join(" ");
};
