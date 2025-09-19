import clsx from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * ClassName Util Function that combines twMerge and clsx
 * @param classes
 */
export function cn(...classes: clsx.ClassValue[]) {
  return twMerge(clsx(...classes));
}

export const handleEnterOrSpace =
  (
    callback: () => void,
    options?: { stopPropagation?: boolean; preventDefault?: boolean }
  ) =>
  (e: React.KeyboardEvent<HTMLElement>) => {
    if (options?.stopPropagation) {
      e.stopPropagation();
    }
    if (options?.preventDefault) {
      e.preventDefault();
    }
    if (e.key === "Enter" || e.key === " ") {
      callback();
    }
  };

export const handleEscape =
  (callback: () => void) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      callback();
    }
  };

export const handleClick =
  (
    callback: () => void,
    options?: { stopPropagation?: boolean; preventDefault?: boolean }
  ) =>
  (e: React.MouseEvent<HTMLElement>) => {
    if (options?.stopPropagation) {
      e.stopPropagation();
    }
    if (options?.preventDefault) {
      e.preventDefault();
    }
    callback();
  };
