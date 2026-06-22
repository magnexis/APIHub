/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.05), 0 20px 60px rgba(0,0,0,0.45)",
      },
      backgroundImage: {
        "grid-radial":
          "radial-gradient(circle at top, rgba(102,126,234,0.22), transparent 40%), radial-gradient(circle at bottom right, rgba(14,165,233,0.16), transparent 30%)",
      },
    },
  },
  plugins: [],
};
