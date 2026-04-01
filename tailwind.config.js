/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm neutral palette — tinted toward brown/amber, never pure gray
        warm: {
          50:  '#faf8f5',
          100: '#f5f0ea',
          150: '#ede6dc',
          200: '#e2d9cc',
          300: '#c9bba8',
          400: '#a89882',
          500: '#8a7a64',
          600: '#6d5f4b',
          700: '#524839',
          800: '#3a332a',
          850: '#2c261f',
          900: '#201c17',
          950: '#171410',
        },
        // Amber accent — warm, inviting, never cold
        accent: {
          50:  '#fff9ed',
          100: '#ffefd0',
          200: '#ffdda0',
          300: '#ffc666',
          400: '#ffab33',
          500: '#f59315',
          600: '#d9750a',
          700: '#b4570c',
          800: '#924511',
          900: '#783a12',
        },
        // Coral secondary — playful warmth
        coral: {
          400: '#fb8f7a',
          500: '#f06d53',
        },
      },
      fontFamily: {
        sans: [
          'Outfit',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'warm-sm': '0 1px 3px rgba(120, 58, 18, 0.06), 0 1px 2px rgba(120, 58, 18, 0.04)',
        'warm-md': '0 4px 16px rgba(120, 58, 18, 0.08)',
        'warm-lg': '0 8px 32px rgba(120, 58, 18, 0.10)',
        'warm-glow': '0 0 24px rgba(245, 147, 21, 0.15)',
        'card': '0 2px 8px rgba(23, 20, 16, 0.4), 0 0 0 1px rgba(201, 187, 168, 0.06)',
        'card-hover': '0 8px 24px rgba(23, 20, 16, 0.5), 0 0 0 1px rgba(201, 187, 168, 0.10)',
      },
      animation: {
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'warm-pulse': 'warm-pulse 2.5s ease-in-out infinite',
        'fade-in': 'fade-in 0.4s ease-out',
        'slide-up': 'slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'shimmer': {
          '0%':   { backgroundPosition: '-468px 0' },
          '100%': { backgroundPosition: '468px 0' },
        },
        'warm-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(245, 147, 21, 0.2)' },
          '50%':      { boxShadow: '0 0 36px rgba(245, 147, 21, 0.4)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
