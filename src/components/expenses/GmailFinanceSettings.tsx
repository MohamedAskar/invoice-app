import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GmailSyncCard } from './GmailSyncCard';
import { completePendingGmailConnection, disconnectGmail, getGmailConnection, setGmailSchedule, startGmailConnection, type GmailConnection } from '@/lib/gmail';
import { useExpenses } from '@/hooks/useExpenses';

export function GmailFinanceSettings() {
  const navigate = useNavigate();
  const syncGmail = useExpenses(state => state.syncGmail);
  const summary = useExpenses(state => state.gmailSummary);
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        if (await completePendingGmailConnection() && mounted) {
          navigate('/settings/finance?gmail=connected', { replace: true });
          setNotice('Gmail connected. The initial check is queued.');
        }
      } catch { if (mounted) setError('Could not connect Gmail. Reconnect to start a new authorization.'); }
      try {
        const current = await getGmailConnection();
        if (mounted) setConnection(current);
      } catch { if (mounted) setError('Could not load Gmail settings. Refresh the page to try again.'); }
      finally { if (mounted) setLoading(false); }
    };
    void initialize();
    return () => { mounted = false; };
  }, [navigate]);
  useEffect(() => {
    if (loading || busy) return;
    if (connection?.status !== 'disconnecting' && !['queued', 'running'].includes(connection?.syncStatus ?? '')) return;
    let mounted = true;
    const interval = window.setInterval(() => {
      void getGmailConnection().then((current) => { if (mounted) setConnection(current); }).catch(() => {
        if (mounted) setError('Could not refresh sync status. Refresh the page to try again.');
      });
    }, 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [connection?.syncStatus, connection?.status, loading, busy]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch { setError('Could not update Gmail. Refresh the page to confirm its current status and try again.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <GmailSyncCard connection={connection} loading={loading} busy={busy} summary={summary}
      onConnect={() => void act(async () => { window.location.assign((await startGmailConnection()).authorizationUrl); })}
      onSync={() => void act(async () => { try { await syncGmail(); navigate('/expenses?status=needs_review'); } finally { setConnection(await getGmailConnection()); } })}
      onScheduleChange={(enabled) => void act(async () => { setConnection(await setGmailSchedule(enabled)); })}
      onDisconnect={() => void act(async () => {
        // The connection may already be disabled even if completion's response
        // is lost. Never show its previous active schedule while reconciling.
        setLoading(true);
        try {
          const result = await disconnectGmail(); setConnection(result.connection); setLoading(false);
          setNotice(result.connection?.status === 'disconnecting' ? 'Gmail imports are stopped. Disconnect is pending; retry to check progress. Imported receipts and expenses are retained.'
            : result.revocationAttempted ? 'Gmail disconnected. Imported receipts and expenses are retained.'
            : 'Gmail disconnected locally. Google revocation could not be confirmed; you can remove access in your Google account. Imported receipts and expenses are retained.');
        } catch (failure) {
          try { setConnection(await getGmailConnection()); setLoading(false); }
          catch { /* Keep stale status hidden until the page can be refreshed. */ }
          throw failure;
        }
      })}
    />
  </div>;
}
