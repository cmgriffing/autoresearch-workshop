import { CartCount } from './CartCount.jsx';

export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          ◆
        </span>
        Northlight
      </a>
      <nav className="site-nav" aria-label="Categories">
        <a href="#lamps">Lamps</a>
        <a href="#lighting">Lighting</a>
        <a href="#sale">Sale</a>
      </nav>
      <a className="cart-link" href="#cart">
        Cart <CartCount />
      </a>
    </header>
  );
}
