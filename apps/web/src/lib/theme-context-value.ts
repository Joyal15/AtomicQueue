import { createContext } from 'react'

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

// Split out so theme-context.tsx only exports the `ThemeProvider`
// component (react-refresh requires that). Both `ThemeProvider` and
// `useTheme` import the context from here.
export const ThemeContext = createContext<ThemeContextValue | null>(null)
