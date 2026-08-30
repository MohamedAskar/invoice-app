export function accountingDateForExpense(input: { expenseDate: string; paidDate?: string }) {
  return input.paidDate || input.expenseDate;
}

export function expenseTotal(netAmount: number, vatAmount: number) {
  return Math.round((netAmount + vatAmount) * 100) / 100;
}
