import { pdf } from '@react-pdf/renderer';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { Expense, BusinessSettings, expenseCategoryLabels } from '@/types/invoice';
import { formatCurrency, formatDate } from './formatting';

// Design tokens for consistent styling
const FONT_SIZE = {
  xs: 8,
  sm: 10,
  lg: 16,
  xl: 24,
} as const;

const COLORS = {
  muted: '#71717A',
  faint: '#B3B3B3',
  border: '#D1D5DB',
  rowBorder: '#E5E5E5',
  black: '#000000',
} as const;

interface ExpenseReportPDFProps {
  expenses: Expense[];
  settings: BusinessSettings;
  dateFrom: string;
  dateTo: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: FONT_SIZE.xs,
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
  title: {
    fontSize: FONT_SIZE.xl,
    fontWeight: 'bold',
    letterSpacing: -0.7,
    lineHeight: 1.11,
  },
  subtitle: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.muted,
    lineHeight: 1.43,
  },
  headerDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 32,
  },
  metaSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  metaItem: {
    width: '30%',
  },
  metaLabel: {
    fontSize: FONT_SIZE.xs,
    fontWeight: 'bold',
    color: COLORS.faint,
    letterSpacing: 0.5,
    marginBottom: 8,
    lineHeight: 1.33,
  },
  metaValue: {
    fontSize: FONT_SIZE.sm,
    fontWeight: 'normal',
    lineHeight: 1.43,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 16,
  },
  table: {
    marginBottom: 32,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.black,
    paddingBottom: 12,
    marginBottom: 0,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    borderBottomStyle: 'dashed',
    paddingVertical: 12,
  },
  colDate: {
    width: '14%',
  },
  colName: {
    width: '28%',
  },
  colVendor: {
    width: '20%',
  },
  colCategory: {
    width: '16%',
  },
  colAmount: {
    width: '22%',
    textAlign: 'right',
  },
  tableHeaderText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: 'bold',
    color: COLORS.muted,
    letterSpacing: 0.5,
    lineHeight: 1.33,
  },
  tableText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: 1.43,
  },
  tableTextMuted: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.muted,
    marginTop: 2,
    lineHeight: 1.33,
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 32,
  },
  totalLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: 'bold',
    color: COLORS.muted,
    marginRight: 32,
    lineHeight: 1.43,
  },
  totalAmount: {
    fontSize: FONT_SIZE.lg,
    fontWeight: 'bold',
    lineHeight: 1.33,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 0,
  },
  footerDividerContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.black,
    paddingTop: 16,
  },
  footerText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.muted,
    lineHeight: 1.33,
  },
});

function ExpenseReportPDF({ expenses, settings, dateFrom, dateTo }: ExpenseReportPDFProps) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Expenses Report</Text>
              <Text style={styles.subtitle}>{settings.name}</Text>
            </View>
            <Text style={styles.subtitle}>
              {formatDate(dateFrom)} – {formatDate(dateTo)}
            </Text>
          </View>

          <View style={styles.headerDivider} />

          {/* Meta */}
          <View style={styles.metaSection}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>PERIOD</Text>
              <Text style={styles.metaValue}>
                {formatDate(dateFrom)} – {formatDate(dateTo)}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>TOTAL EXPENSES</Text>
              <Text style={styles.metaValue}>{expenses.length}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>GENERATED ON</Text>
              <Text style={styles.metaValue}>{formatDate(new Date().toISOString().split('T')[0])}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Table */}
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.colDate]}>DATE</Text>
              <Text style={[styles.tableHeaderText, styles.colName]}>EXPENSE</Text>
              <Text style={[styles.tableHeaderText, styles.colVendor]}>VENDOR</Text>
              <Text style={[styles.tableHeaderText, styles.colCategory]}>CATEGORY</Text>
              <Text style={[styles.tableHeaderText, styles.colAmount]}>AMOUNT</Text>
            </View>

            {expenses.map((expense) => (
              <View key={expense.id} style={styles.tableRow}>
                <Text style={[styles.tableText, styles.colDate]}>
                  {formatDate(expense.date)}
                </Text>
                <View style={styles.colName}>
                  <Text style={styles.tableText}>{expense.name}</Text>
                  {expense.description && (
                    <Text style={styles.tableTextMuted}>{expense.description}</Text>
                  )}
                </View>
                <Text style={[styles.tableText, styles.colVendor]}>{expense.vendor}</Text>
                <Text style={[styles.tableText, styles.colCategory]}>
                  {expenseCategoryLabels[expense.category]}
                </Text>
                <Text style={[styles.tableText, styles.colAmount]}>
                  {formatCurrency(expense.amount)}
                </Text>
              </View>
            ))}
          </View>

          {/* Total */}
          <View style={styles.totalSection}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerDividerContainer}>
            <Text style={styles.footerText}>
              {settings.name} · {settings.street} · {settings.postalCode} {settings.city}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function generateExpenseReportPDF(
  expenses: Expense[],
  settings: BusinessSettings,
  dateFrom: string,
  dateTo: string
): Promise<void> {
  try {
    const blob = await pdf(
      <ExpenseReportPDF
        expenses={expenses}
        settings={settings}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />
    ).toBlob();

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Expenses-Report-${dateFrom}-to-${dateTo}.pdf`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating expense report PDF:', error);
    throw new Error('Failed to generate expense report PDF. Please try again.');
  }
}
