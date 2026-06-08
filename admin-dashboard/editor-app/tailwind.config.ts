import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Editor UI palette. Values are driven by CSS variables (RGB
        // channels) defined in index.css so the whole editor chrome can
        // switch between light and dark — see the theme switcher in the
        // top bar. The `<alpha-value>` placeholder keeps Tailwind opacity
        // modifiers (e.g. bg-ed-accent/15) working.
        ed: {
          bg:       'rgb(var(--ed-bg) / <alpha-value>)',
          surface:  'rgb(var(--ed-surface) / <alpha-value>)',
          panel:    'rgb(var(--ed-panel) / <alpha-value>)',
          border:   'rgb(var(--ed-border) / <alpha-value>)',
          border2:  'rgb(var(--ed-border2) / <alpha-value>)',
          hover:    'rgb(var(--ed-hover) / <alpha-value>)',
          active:   'rgb(var(--ed-active) / <alpha-value>)',
          text:     'rgb(var(--ed-text) / <alpha-value>)',
          muted:    'rgb(var(--ed-muted) / <alpha-value>)',
          'text-2': 'rgb(var(--ed-text-2) / <alpha-value>)',
          'text-3': 'rgb(var(--ed-text-3) / <alpha-value>)',
          accent:   'rgb(var(--ed-accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--ed-accent-hover) / <alpha-value>)',
          danger:   'rgb(var(--ed-danger) / <alpha-value>)',
          success:  'rgb(var(--ed-success) / <alpha-value>)',
          warning:  'rgb(var(--ed-warning) / <alpha-value>)',
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
