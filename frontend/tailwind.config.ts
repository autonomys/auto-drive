import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "#000000",
        accent: "#0A8DD0",
        "lighter-accent": "#90C2E7",
        "light-danger": "#ffcdd2",
        "gray-button": "#9EA49F",
      },
    },
  },
  plugins: [],
};
export default config;
