/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ram: {
          red: "#BE1E2D",      // RAM brand red
          redDark: "#9D1826",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.05)",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
