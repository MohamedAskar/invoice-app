import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailFinanceSettings } from './GmailFinanceSettings';
import { completePendingGmailConnection, disconnectGmail, getGmailConnection } from '@/lib/gmail';

vi.mock('@/lib/gmail', () => ({ completePendingGmailConnection: vi.fn(), disconnectGmail: vi.fn(), getGmailConnection: vi.fn(),
  requestGmailSync: vi.fn(), setGmailSchedule: vi.fn(), startGmailConnection: vi.fn() }));
vi.mock('@/hooks/useExpenses', () => ({ useExpenses: (selector: (state: unknown) => unknown) => selector({ syncGmail: vi.fn(), gmailSummary: undefined }) }));
const active = { status: 'active' as const, gmailAddress: 'synthetic@example.test', dailySyncEnabled: true, lastSyncedAt: null };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(completePendingGmailConnection).mockResolvedValue(false); });
afterEach(cleanup);

describe('Gmail disconnect status reconciliation', () => {
  it('hides the old active schedule during revocation and reloads persisted state after an error', async () => {
    vi.mocked(getGmailConnection).mockResolvedValueOnce(active).mockResolvedValueOnce({ ...active, status: 'disconnecting', dailySyncEnabled: false });
    let reject!: (error: Error) => void;
    vi.mocked(disconnectGmail).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    render(<MemoryRouter><GmailFinanceSettings /></MemoryRouter>);
    await screen.findByText(/checked automatically every day/);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
    expect(screen.queryByText(/checked automatically every day/)).not.toBeInTheDocument();
    reject(new Error('synthetic completion persistence failure'));
    await screen.findByText('Disconnect pending');
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry disconnect' })).toBeEnabled();
  });
  it('does not restore a stale active schedule when both disconnect and status refresh fail', async () => {
    vi.mocked(getGmailConnection).mockResolvedValueOnce(active).mockRejectedValueOnce(new Error('synthetic outage'));
    vi.mocked(disconnectGmail).mockRejectedValue(new Error('synthetic outage'));
    render(<MemoryRouter><GmailFinanceSettings /></MemoryRouter>);
    await screen.findByText(/checked automatically every day/);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
    await waitFor(() => expect(getGmailConnection).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/checked automatically every day/)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/refresh the page/i);
  });
});
