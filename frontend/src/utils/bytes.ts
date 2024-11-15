const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

const BIBYTE_UNITS = [
  'B',
  'KiB',
  'MiB',
  'GiB',
  'TiB',
  'PiB',
  'EiB',
  'ZiB',
  'YiB',
];

const BIT_UNITS = [
  'b',
  'kbit',
  'Mbit',
  'Gbit',
  'Tbit',
  'Pbit',
  'Ebit',
  'Zbit',
  'Ybit',
];

const BIBIT_UNITS = [
  'b',
  'kibit',
  'Mibit',
  'Gibit',
  'Tibit',
  'Pibit',
  'Eibit',
  'Zibit',
  'Yibit',
];

/*
Formats the given number using `Number#toLocaleString`.
- If locale is a string, the value is expected to be a locale-key (for example: `de`).
- If locale is true, the system default locale is used for translation.
- If no value for locale is specified, the number is returned unmodified.
*/
const toLocaleString = (number, locale, options) => {
  let result = number;
  if (typeof locale === 'string' || Array.isArray(locale)) {
    result = number.toLocaleString(locale, options);
  } else if (locale === true || options !== undefined) {
    result = number.toLocaleString(undefined, options);
  }

  return result;
};

export default function prettyBytes(
  number: bigint,
  options: {
    bits?: boolean;
    binary?: boolean;
    space?: boolean;
    signed?: boolean;
    locale?: string | string[];
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  },
) {
  if (!Number.isFinite(number)) {
    throw new TypeError(
      `Expected a finite number, got ${typeof number}: ${number}`,
    );
  }

  options = {
    bits: false,
    binary: false,
    space: true,
    ...options,
  };

  const UNITS = options.bits
    ? options.binary
      ? BIBIT_UNITS
      : BIT_UNITS
    : options.binary
      ? BIBYTE_UNITS
      : BYTE_UNITS;

  const separator = options.space ? ' ' : '';

  if (options.signed && number === BigInt(0).valueOf()) {
    return ` 0${separator}${UNITS[0]}`;
  }

  const isNegative = number < 0;
  const prefix = isNegative ? '-' : options.signed ? '+' : '';

  if (isNegative) {
    number = -number;
  }

  let localeOptions;

  if (options.minimumFractionDigits !== undefined) {
    localeOptions = { minimumFractionDigits: options.minimumFractionDigits };
  }

  if (options.maximumFractionDigits !== undefined) {
    localeOptions = {
      maximumFractionDigits: options.maximumFractionDigits,
      ...localeOptions,
    };
  }

  if (number < 1) {
    const numberString = toLocaleString(number, options.locale, localeOptions);
    return prefix + numberString + separator + UNITS[0];
  }

  const exponent = Math.min(
    Math.floor(
      options.binary
        ? BigInt.log(number) / BigInt.log(BigInt(1024).valueOf())
        : BigInt.log10(number) / BigInt(3).valueOf(),
    ),
    UNITS.length - 1,
  );
  number /=
    (options.binary ? BigInt(1024).valueOf() : BigInt(1000).valueOf()) **
    exponent;

  if (!localeOptions) {
    number = number.toPrecision(3);
  }

  const numberString = toLocaleString(
    Number(number),
    options.locale,
    localeOptions,
  );

  const unit = UNITS[exponent];

  return prefix + numberString + separator + unit;
}
