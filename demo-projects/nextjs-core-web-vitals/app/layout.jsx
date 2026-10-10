import './globals.css';
import { CartProvider } from './components/CartProvider.jsx';
import { Header } from './components/Header.jsx';
import { pimUrlFromEnv } from './lib/data.js';

export const metadata = {
  title: 'Northlight — lighting for every room',
  description: 'Product detail storefront.',
};

export default function RootLayout({ children }) {
  const pimUrl = pimUrlFromEnv();

  const fontFaces = `
    @font-face {
      font-family: 'Northlight Brand';
      src: url('${pimUrl}/fonts/brand-400.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: auto;
    }
    @font-face {
      font-family: 'Northlight Brand';
      src: url('${pimUrl}/fonts/brand-600.woff2') format('woff2');
      font-weight: 600;
      font-style: normal;
      font-display: auto;
    }
  `;

  return (
    <html lang="en">
      <body>
        <link rel="stylesheet" href="/vendor.css" precedence="default" />
        <style dangerouslySetInnerHTML={{ __html: fontFaces }} />
        <CartProvider>
          <Header />
          {children}
        </CartProvider>
      </body>
    </html>
  );
}
