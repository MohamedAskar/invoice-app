import { describe, expect, it } from 'vitest';
import { getInitialInvoiceStatus, getInvoiceSaveStatus } from './invoice-status';

describe('getInitialInvoiceStatus', () => {
  it('starts a new invoice as a draft', () => {
    expect(getInitialInvoiceStatus()).toBe('draft');
  });

  it('preserves a legacy invoice status while editing', () => {
    expect(getInitialInvoiceStatus({ status: 'pending' })).toBe('pending');
  });

  it('persists a past-due legacy pending invoice as pending when only its note changes', () => {
    expect(getInvoiceSaveStatus({
      displayStatus: 'overdue',
      persistedStatus: 'pending',
      statusChanged: false,
    })).toBe('pending');
  });
});
