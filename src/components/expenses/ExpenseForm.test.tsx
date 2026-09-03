import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseForm } from './ExpenseForm';

describe('ExpenseForm', () => {
  it('keeps a new uploaded receipt in review until the user books it', async () => {
    const onSave = vi.fn();

    render(<ExpenseForm initialStatus="needs_review" onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(/vendor/i), 'Figma');
    await userEvent.click(screen.getByRole('button', { name: /save for review/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: 'Figma', status: 'needs_review' })
    );
  });
});
