import { useApp } from '../state';

export function Modal() {
  const { modalOpen, closeModal } = useApp();
  if (!modalOpen) return null;
  return (
    <div className="modal-layer">
      <div className="modal-panel" data-bench-part="modal-panel" role="dialog" aria-modal="true">
        <h2>Confirm session action</h2>
        <p>This is a demo confirmation dialog.</p>
        <div className="modal-actions">
          <button type="button" data-bench="modal-confirm" onClick={closeModal}>
            Confirm
          </button>
          <button type="button" data-bench="modal-dismiss" onClick={closeModal}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
