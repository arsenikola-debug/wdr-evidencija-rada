import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth/AuthProvider';
import type { NotificationItem } from '../lib/api/types';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';

export function Notifications() {
  const { api } = useAuth();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listNotifications()
      .then(setItems)
      .catch((e: unknown) =>
        setError(messageForCode(null, e instanceof Error ? e.message : undefined)),
      );
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!items) return <Spinner label="Učitavanje obaveštenja…" />;
  if (items.length === 0) return <EmptyState title="Nema obaveštenja" />;

  const unread = items.filter((i) => !i.read_at).length;

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Obaveštenja</h1>
          <p className="muted">Rokovi, povratne informacije finansija i promene statusa.</p>
        </div>
        {unread > 0 && (
          <div className="page-head-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void api.markNotificationsRead().then(() => load())}
            >
              Označi sve kao pročitano ({unread})
            </button>
          </div>
        )}
      </div>
      <ul className="notif-list">
        {items.map((n) => (
          <li key={n.id} className={n.read_at ? 'read' : 'unread'}>
            <span className="notif-type">{n.type}</span>
            <span className="notif-text">{n.text}</span>
            <span className="notif-date">
              {new Date(n.created_at).toLocaleString('sr-Latn-RS')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
