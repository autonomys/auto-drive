export type TokenPriceResponse = {
  result: {
    [ticker: string]: {
      a: [string, string, string];
      b: [string, string, string];
      c: [string, string];
      v: [string, string];
      p: [string, string];
      t: [number, number];
      l: [string, string];
      h: [string, string];
      o: string;
    };
  };
};

const AI3_TICKER = 'AI3USD';
const ONE_HOUR = 1000 * 60 * 60;

export const tokenPriceService = {
  lastPriceFetchedAt: 0,
  lastPrice: 0,
  fetchPrice: async (ticker: string) => {
    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${ticker}`,
    );
    const data: TokenPriceResponse = await response.json();

    const price = data.result[ticker].c[0];

    tokenPriceService.lastPriceFetchedAt = Date.now();
    tokenPriceService.lastPrice = Number(price);

    return price;
  },
  getPrice: async () => {
    if (tokenPriceService.lastPriceFetchedAt > Date.now() - ONE_HOUR) {
      return tokenPriceService.lastPrice;
    }
    return Number(await tokenPriceService.fetchPrice(AI3_TICKER));
  },
};
