import type { Notice } from '../lib/useRoom';

interface Props {
  notices: Notice[];
  onDismiss: (id: number) => void;
}

export function Notices({ notices, onDismiss }: Props) {
  if (notices.length === 0) return null;

  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          className={`notice notice--${notice.level}`}
          onClick={() => onDismiss(notice.id)}
        >
          {notice.message}
        </button>
      ))}
    </div>
  );
}
