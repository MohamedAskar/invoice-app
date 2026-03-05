import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { pdf } from '@react-pdf/renderer';
import { Expense, BusinessSettings, ExpenseCategory, expenseCategoryLabels } from '@/types/invoice';
import { formatCurrency, formatDate } from './formatting';

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 8,
    flexDirection: 'column',
  },
  content: {
    flex: 1,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: -0.7,
    lineHeight: 1.11,
  },
  subtitle: {
    fontSize: 10,
    color: '#71717A',
    lineHeight: 1.43,
  },
  businessInfo: {
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#B3B3B3',
    letterSpacing: 0.5,
    marginBottom: 12,
    lineHeight: 1.33,
  },
  businessName: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 2,
    lineHeight: 1.43,
  },
  businessText: {
    fontSize: 10,
    marginBottom: 2,
    lineHeight: 1.43,
  },
  summarySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  summaryItem: {
    width: '30%',
  },
  summaryLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#B3B3B3',
    letterSpacing: 0.5,
    marginBottom: 8,
    lineHeight: 1.33,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 1.43,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    marginBottom: 16,
  },
  categorySectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 16,
    lineHeight: 1.33,
  },
  table: {
    marginBottom: 32,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 12,
    marginBottom: 0,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    borderBottomStyle: 'dashed',
    paddingVertical: 10,
  },
  tableRowTotal: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#000000',
    paddingVertical: 12,
  },
  colDate: {
    width: '15%',
  },
  colDescription: {
    width: '35%',
  },
  colCategory: {
    width: '25%',
  },
  colAmount: {
    width: '25%',
    textAlign: 'right',
  },
  // Category breakdown table columns
  colCategoryName: {
    width: '50%',
  },
  colCategoryAmount: {
    width: '25%',
    textAlign: 'right',
  },
  colCategoryPercent: {
    width: '25%',
    textAlign: 'right',
  },
  tableHeaderText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#71717A',
    letterSpacing: 0.5,
    lineHeight: 1.33,
  },
  tableText: {
    fontSize: 9,
    lineHeight: 1.43,
  },
  tableTextBold: {
    fontSize: 9,
    fontWeight: 'bold',
    lineHeight: 1.43,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#D1D5DB',
  },
  footerText: {
    fontSize: 8,
    color: '#71717A',
    lineHeight: 1.33,
  },
});

interface ExpenseReportPDFProps {
  expenses: Expense[];
  settings: BusinessSettings;
  startDate: string;
  endDate: string;
}

function ExpenseReportPDF({ expenses, settings, startDate, endDate }: ExpenseReportPDFProps) {
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Group by category
  const categoryTotals = expenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
    return acc;
  }, {});

  const sortedCategories = Object.entries(categoryTotals).sort(([, a], [, b]) => b - a);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Expense Report</Text>
            <Text style={styles.subtitle}>
              {formatDate(startDate)} – {formatDate(endDate)}
            </Text>
          </View>

          <View style={styles.headerDivider} />

          {/* Business Info */}
          {settings.name && (
            <View style={styles.businessInfo}>
              <Text style={styles.sectionLabel}>BUSINESS</Text>
              <Text style={styles.businessName}>{settings.name}</Text>
              {settings.street && <Text style={styles.businessText}>{settings.street}</Text>}
              {(settings.postalCode || settings.city) && (
                <Text style={styles.businessText}>
                  {`${settings.postalCode} ${settings.city}`}
                </Text>
              )}
            </View>
          )}

          {/* Summary */}
          <View style={styles.summarySection}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>TOTAL EXPENSES</Text>
              <Text style={styles.summaryValue}>{formatCurrency(totalAmount)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>NUMBER OF EXPENSES</Text>
              <Text style={styles.summaryValue}>{expenses.length}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>CATEGORIES</Text>
              <Text style={styles.summaryValue}>{sortedCategories.length}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Category Breakdown */}
          <Text style={styles.categorySectionTitle}>Category Breakdown</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.colCategoryName]}>CATEGORY</Text>
              <Text style={[styles.tableHeaderText, styles.colCategoryAmount]}>AMOUNT</Text>
              <Text style={[styles.tableHeaderText, styles.colCategoryPercent]}>% OF TOTAL</Text>
            </View>
            {sortedCategories.map(([category, amount]) => (
              <View key={category} style={styles.tableRow}>
                <Text style={[styles.tableText, styles.colCategoryName]}>
                  {expenseCategoryLabels[category as ExpenseCategory]}
                </Text>
                <Text style={[styles.tableText, styles.colCategoryAmount]}>
                  {formatCurrency(amount)}
                </Text>
                <Text style={[styles.tableText, styles.colCategoryPercent]}>
                  {totalAmount > 0 ? ((amount / totalAmount) * 100).toFixed(1) : 0}%
                </Text>
              </View>
            ))}
            <View style={styles.tableRowTotal}>
              <Text style={[styles.tableTextBold, styles.colCategoryName]}>Total</Text>
              <Text style={[styles.tableTextBold, styles.colCategoryAmount]}>
                {formatCurrency(totalAmount)}
              </Text>
              <Text style={[styles.tableTextBold, styles.colCategoryPercent]}>100%</Text>
            </View>
          </View>

          {/* Detailed Expenses */}
          <Text style={styles.categorySectionTitle}>Expense Details</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.colDate]}>DATE</Text>
              <Text style={[styles.tableHeaderText, styles.colDescription]}>DESCRIPTION</Text>
              <Text style={[styles.tableHeaderText, styles.colCategory]}>CATEGORY</Text>
              <Text style={[styles.tableHeaderText, styles.colAmount]}>AMOUNT</Text>
            </View>
            {expenses.map((expense) => (
              <View key={expense.id} style={styles.tableRow}>
                <Text style={[styles.tableText, styles.colDate]}>
                  {formatDate(expense.date)}
                </Text>
                <Text style={[styles.tableText, styles.colDescription]}>
                  {expense.description}
                </Text>
                <Text style={[styles.tableText, styles.colCategory]}>
                  {expenseCategoryLabels[expense.category]}
                </Text>
                <Text style={[styles.tableText, styles.colAmount]}>
                  {formatCurrency(expense.amount)}
                </Text>
              </View>
            ))}
            <View style={styles.tableRowTotal}>
              <Text style={[styles.tableTextBold, styles.colDate]}></Text>
              <Text style={[styles.tableTextBold, styles.colDescription]}></Text>
              <Text style={[styles.tableTextBold, styles.colCategory]}>Total</Text>
              <Text style={[styles.tableTextBold, styles.colAmount]}>
                {formatCurrency(totalAmount)}
              </Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Generated on {formatDate(new Date().toISOString().split('T')[0])}
            {settings.name ? ` · ${settings.name}` : ''}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateExpenseReport(
  expenses: Expense[],
  settings: BusinessSettings,
  startDate: string,
  endDate: string
): Promise<void> {
  try {
    const blob = await pdf(
      <ExpenseReportPDF
        expenses={expenses}
        settings={settings}
        startDate={startDate}
        endDate={endDate}
      />
    ).toBlob();

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const startStr = formatDate(startDate).replace(/\./g, '-');
    const endStr = formatDate(endDate).replace(/\./g, '-');
    link.download = `Expense-Report-${startStr}-to-${endStr}.pdf`;

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating expense report:', error);
    throw new Error('Failed to generate expense report. Please try again.');
  }
}
