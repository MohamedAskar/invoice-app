import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GmailSyncCard } from './GmailSyncCard';
import { completePendingGmailConnection, disconnectGmail, getGmailConnection, requestGmailSync, setGmailSchedule, startGmailConnection, type GmailConnection } from '@/lib/gmail';

export function GmailFinanceSettings() {
  const navigate = useNavigate();
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
    if (!['queued', 'running'].includes(connection?.syncStatus ?? '')) return;
    let mounted = true;
    const interval = window.setInterval(() => {
      void getGmailConnection().then((current) => { if (mounted) setConnection(current); }).catch(() => {
        if (mounted) setError('Could not refresh sync status. Refresh the page to try again.');
      });
    }, 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [connection?.syncStatus]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch { setError('Could not update Gmail. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <GmailSyncCard connection={connection} loading={loading} busy={busy}
      onConnect={() => void act(async () => { window.location.assign((await startGmailConnection()).authorizationUrl); })}
      onSync={() => void act(async () => { setConnection(await requestGmailSync()); setNotice('Sync requested. New receipts will appear as review drafts.'); })}
      onScheduleChange={(enabled) => void act(async () => { setConnection(await setGmailSchedule(enabled)); })}
      onDisconnect={() => void act(async () => {
        const result = await disconnectGmail(); setConnection(result.connection);
        setNotice(result.revocationAttempted ? 'Gmail disconnected. Imported receipts and expenses are retained.'
          : 'Gmail disconnected locally. Google revocation could not be confirmed; you can remove access in your Google account. Imported receipts and expenses are retained.');
      })}
    />
  </div>;
}
