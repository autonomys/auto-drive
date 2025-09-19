export type CoingeckoCoinDetails = {
  id: string;
  market_data: {
    current_price: {
      usd: number;
    };
  };
};

export const coingecko = {
  getPrice: async () => {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ai3&vs_currencies=usd',
    );
    const data: CoingeckoCoinDetails = await response.json();

    return data.market_data.current_price.usd;
  },
};
