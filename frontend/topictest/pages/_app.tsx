import type { AppProps } from 'next/app';
import '../styles/main.css';
import { ThemeProvider } from '../lib/ThemeContext';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <Component {...pageProps} />
    </ThemeProvider>
  );
}
