import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Editor dark UI palette
        ed: {
          bg:       '#0d0d0d',
          surface:  '#141414',
          panel:    '#181818',
          border:   '#242424',
          border2:  '#2e2e2e',
          hover:    '#1e1e1e',
          active:   '#1a2840',
          text:     '#e0e0e0',
          muted:    '#888888',
          'text-2': '#a0a0a0',
          'text-3': '#666666',
          accent:   '#0d6efd',
          'accent-hover': '#0b5ed7',
          danger:   '#ef4444',
          success:  '#22c55e',
          warning:  '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['10px', '14px'],
        xs:    ['11px', '15px'],
        sm:    ['12px', '16px'],
        base:  ['13px', '18px'],
        md:    ['14px', '20px'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
};

export default config;
