import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { GmailConnection } from '@/lib/gmail';
import type { GmailSyncSummary } from '@/lib/finance-storage';

interface Props {
  connection: GmailConnection | null;
  onConnect: () => void; onSync: () => void;
  onDisconnect?: () => void; onScheduleChange?: (enabled: boolean) => void;
  busy?: boolean; loading?: boolean;
  summary?: GmailSyncSummary;
}
export function GmailSyncCard({ connection, onConnect, onSync, onDisconnect, onScheduleChange, busy = false, loading = false, summary }: Props) {
  const active = connection?.status === 'active';
  const disconnecting = connection?.status === 'disconnecting';
  const syncing = connection?.syncStatus === 'queued' || connection?.syncStatus === 'running';
  const time = (value?: string | null) => value ? <time dateTime={value}>{new Date(value).toLocaleString()}</time> : 'Never';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail receipt imports</CardTitle>
        <CardDescription>Connect Gmail to find business expense documents for your review.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {summary && <p role="status">{summary.needsReview} candidates need review · {summary.documents} documents · {summary.ignored} ignored · {summary.skipped} duplicates skipped</p>}
        <p className="text-sm text-muted-foreground">
          The app searches incoming mail for likely invoices and receipts during an initial backfill and daily incremental checks.
          It does not modify Gmail, excludes sent client invoices, and creates review drafts for you to check before booking expenses.
        </p>
        {loading ? <p role="status">Loading Gmail connection…</p> : <>
          <div className="text-sm">
            <p className="font-medium">{active ? 'Connected' : disconnecting ? 'Disconnect pending' : connection?.status === 'reauthorization_required' ? 'Reconnect required' : 'Not connected'}</p>
            {connection?.gmailAddress && <p>{connection.gmailAddress}</p>}
            {connection?.status === 'reauthorization_required' && <p>Gmail access needs renewed permission. Reconnect the same Gmail account to resume imports.</p>}
            {disconnecting && <p>Imports are stopped. Reconnection is available after Gmail access removal finishes. Retry disconnect; if it remains pending, contact support.</p>}
          </div>
          {active && <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch id="gmail-daily-sync" checked={connection.dailySyncEnabled} disabled={busy || !onScheduleChange} onCheckedChange={onScheduleChange} />
              <Label htmlFor="gmail-daily-sync">Daily automatic checks</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              {connection.dailySyncEnabled ? 'Schedule active: checked automatically every day.' : 'Schedule paused. You can still sync manually.'}
            </p>
          </div>}
          {connection && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt>Last successful sync</dt><dd>{time(connection.lastSyncedAt)}</dd>
            <dt>Last failed sync</dt><dd>{time(connection.lastFailedAt)}</dd>
          </dl>}
          {syncing && active && <p role="status" className="text-sm">{connection.syncStatus === 'queued' ? 'Sync queued.' : 'Sync in progress…'}</p>}
          <div className="flex flex-wrap gap-3">
            {!active && <Button onClick={onConnect} disabled={busy || disconnecting}>{connection && connection.status !== 'revoked' ? 'Reconnect Gmail' : 'Connect Gmail'}</Button>}
            <Button variant="outline" onClick={onSync} disabled={!active || busy || connection?.syncStatus === 'running'}>Sync now</Button>
            {connection && connection.status !== 'revoked' && onDisconnect && <Button variant="outline" onClick={onDisconnect} disabled={busy}>{disconnecting ? 'Retry disconnect' : 'Disconnect Gmail'}</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Disconnecting stops automatic checks and removes stored Gmail access. Already imported receipts and expenses are retained.</p>
        </>}
      </CardContent>
    </Card>
  );
}
