import { useApp } from '../state';
import type { NewsItem } from '../types';

function NewsItemRow({ item }: { item: NewsItem }) {
  return (
    <article data-bench-part="news-item" data-news-id={item.id} className="news-item">
      <header className="news-item__meta">
        <span>{item.source}</span>
        <span>{item.symbol}</span>
      </header>
      <p>{item.headline}</p>
    </article>
  );
}

export function News() {
  const { news } = useApp();
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>News</h2>
        <span data-bench="news-count">{news.length}</span>
      </header>
      <div className="panel__body news">
        {news.map((item) => (
          <NewsItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

export function Settings() {
  const { openModal, selected, seed } = useApp();
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Session</h2>
      </header>
      <div className="panel__body settings">
        <div className="settings__row">
          <span>Seed</span>
          <span data-bench="settings-seed">{seed}</span>
        </div>
        <div className="settings__row">
          <span>Symbol</span>
          <span data-bench="settings-symbol">{selected ?? '—'}</span>
        </div>
        <button type="button" className="settings__action" data-bench="modal-open" onClick={openModal}>
          Confirm session action
        </button>
      </div>
    </div>
  );
}
