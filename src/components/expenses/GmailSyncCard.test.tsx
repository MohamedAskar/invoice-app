import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailSyncCard } from './GmailSyncCard';

describe('GmailSyncCard', () => {
  it('blocks reconnect during revocation and offers a safe disconnect retry', () => {
    const retry = vi.fn();
    render(<GmailSyncCard connection={{ status: 'disconnecting', gmailAddress: 'me@example.com', lastSyncedAt: null, dailySyncEnabled: false }}
      onConnect={vi.fn()} onSync={vi.fn()} onDisconnect={retry} />);
    expect(screen.getByText('Disconnect pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect gmail/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sync now/i })).toBeDisabled();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry disconnect/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
  afterEach(cleanup);
  it('offers sync and shows the automatic schedule only after Gmail is active', () => {
    render(<GmailSyncCard connection={{ status: 'active', gmailAddress: 'me@example.com', lastSyncedAt: null, dailySyncEnabled: true }} onConnect={vi.fn()} onSync={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sync now/i })).toBeEnabled();
    expect(screen.getByText(/checked automatically every day/i)).toBeInTheDocument();
    expect(screen.queryByText(/refresh token/i)).not.toBeInTheDocument();
  });
  it('requires a connection before manual or automatic checks', () => {
    const connect = vi.fn();
    render(<GmailSyncCard connection={null} onConnect={connect} onSync={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sync now/i })).toBeDisabled();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/checked automatically every day/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /connect gmail/i }));
    expect(connect).toHaveBeenCalledOnce();
    expect(screen.getByText(/does not modify Gmail/)).toHaveTextContent(/excludes sent client invoices/);
    expect(screen.getByText(/does not modify Gmail/)).toHaveTextContent(/creates review drafts/);
  });
  it('allows manual sync while paused and toggles the daily schedule', () => {
    const sync = vi.fn(); const schedule = vi.fn(); const disconnect = vi.fn();
    render(<GmailSyncCard connection={{ status: 'active', gmailAddress: 'me@example.com', lastSyncedAt: '2026-09-01T10:00:00Z', lastFailedAt: '2026-09-02T10:00:00Z', dailySyncEnabled: false }}
      onConnect={vi.fn()} onSync={sync} onScheduleChange={schedule} onDisconnect={disconnect} />);
    expect(screen.getByText(/schedule paused/i)).toBeInTheDocument();
    expect(screen.getByText('Last successful sync').nextElementSibling?.querySelector('time')).toHaveAttribute('dateTime', '2026-09-01T10:00:00Z');
    expect(screen.getByText('Last failed sync').nextElementSibling?.querySelector('time')).toHaveAttribute('dateTime', '2026-09-02T10:00:00Z');
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    fireEvent.click(screen.getByRole('switch', { name: /daily automatic checks/i }));
    fireEvent.click(screen.getByRole('button', { name: /disconnect gmail/i }));
    expect(sync).toHaveBeenCalledOnce(); expect(schedule).toHaveBeenCalledWith(true); expect(disconnect).toHaveBeenCalledOnce();
    expect(screen.getByText(/already imported receipts and expenses are retained/i)).toBeInTheDocument();
  });
  it('disables sync and scheduling when permission must be renewed', () => {
    render(<GmailSyncCard connection={{ status: 'reauthorization_required', gmailAddress: 'me@example.com', lastSyncedAt: null, dailySyncEnabled: true }} onConnect={vi.fn()} onSync={vi.fn()} />);
    expect(screen.getByRole('button', { name: /reconnect gmail/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /sync now/i })).toBeDisabled();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/checked automatically every day/i)).not.toBeInTheDocument();
  });
  it('allows Sync now to claim queued work immediately', () => {
    render(<GmailSyncCard connection={{ status: 'active', gmailAddress: 'me@example.com', lastSyncedAt: null, dailySyncEnabled: true, syncStatus: 'queued' }} onConnect={vi.fn()} onSync={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sync queued.');
    expect(screen.getByRole('button', { name: /sync now/i })).toBeEnabled();
  });
});
