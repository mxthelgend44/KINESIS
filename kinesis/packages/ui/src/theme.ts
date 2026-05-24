// Single source of truth for KINESIS design tokens.
// Mirrors KINESIS/theme.jsx in the design canvas.

export const KINESIS_THEME = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  mist: '#F1EFE9',
  hairline: '#E5E1D8',
  hairlineDk: '#2A3441',
  teal: '#1A6B5A',
  tealDeep: '#114A3F',
  tealLight: '#E6F0EC',
  tealMint: '#D7E8E1',
  amber: '#D4824A',
  amberLight: '#F5E8DC',
  coral: '#C44545',
  coralLight: '#F5DCDC',
  ochre: '#B89968',
  sage: '#5C8A6E',
  sageLight: '#DDE7E0',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
  night: '#0A1118',
  nightSoft: '#0F1822',
  nightCard: '#162230',
} as const;

export type ThemeKey = keyof typeof KINESIS_THEME;

export const FONT_FAMILY = {
  sans: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
  serif: '"Newsreader", "Iowan Old Style", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
} as const;

// Tailwind preset so apps import their colors from here.
export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        bone: KINESIS_THEME.bone,
        paper: KINESIS_THEME.paper,
        mist: KINESIS_THEME.mist,
        hairline: KINESIS_THEME.hairline,
        hairlineDk: KINESIS_THEME.hairlineDk,
        teal: {
          DEFAULT: KINESIS_THEME.teal,
          deep: KINESIS_THEME.tealDeep,
          light: KINESIS_THEME.tealLight,
          mint: KINESIS_THEME.tealMint,
        },
        amber: { DEFAULT: KINESIS_THEME.amber, light: KINESIS_THEME.amberLight },
        coral: { DEFAULT: KINESIS_THEME.coral, light: KINESIS_THEME.coralLight },
        ochre: KINESIS_THEME.ochre,
        sage: { DEFAULT: KINESIS_THEME.sage, light: KINESIS_THEME.sageLight },
        ink: {
          DEFAULT: KINESIS_THEME.ink,
          soft: KINESIS_THEME.inkSoft,
          mute: KINESIS_THEME.inkMute,
          faint: KINESIS_THEME.inkFaint,
        },
        night: {
          DEFAULT: KINESIS_THEME.night,
          soft: KINESIS_THEME.nightSoft,
          card: KINESIS_THEME.nightCard,
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        serif: ['Newsreader', '"Iowan Old Style"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
    },
  },
};
