'use client';

export function VariantPicker({ variants, selectedId, onSelect }) {
  return (
    <div className="variants" data-bench="variant" role="group" aria-label="Finish">
      {variants.map((variant) => {
        const selected = variant.id === selectedId;
        return (
          <button
            key={variant.id}
            type="button"
            className={selected ? 'chip chip-selected' : 'chip'}
            aria-pressed={selected}
            data-bench-part="variant-option"
            data-variant-id={variant.id}
            onClick={() => onSelect(variant.id)}
          >
            {variant.label}
          </button>
        );
      })}
    </div>
  );
}
