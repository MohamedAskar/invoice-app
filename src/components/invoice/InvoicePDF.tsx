import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { Invoice, BusinessSettings } from '@/types/invoice';
import { formatCurrency, formatDate, formatDateRange } from '@/lib/formatting';

interface InvoicePDFProps {
  invoice: Invoice;
  settings: BusinessSettings;
}

// Using Helvetica (built-in react-pdf font) for reliable rendering
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
  invoiceNumber: {
    fontSize: 10,
    color: '#71717A',
    lineHeight: 1.43,
  },
  addressSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  addressBlock: {
    width: '45%',
  },
  sectionLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#B3B3B3',
    letterSpacing: 0.5,
    marginBottom: 12,
    lineHeight: 1.33,
  },
  addressText: {
    fontSize: 10,
    marginBottom: 2,
    lineHeight: 1.43,
  },
  addressName: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 2,
    lineHeight: 1.43,
  },
  taxNumber: {
    fontSize: 8,
    color: '#71717A',
    lineHeight: 1.33,
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
    fontSize: 8,
    fontWeight: 'bold',
    color: '#B3B3B3',
    letterSpacing: 0.5,
    marginBottom: 8,
    lineHeight: 1.33,
  },
  metaValue: {
    fontSize: 10,
    fontWeight: 'normal',
    lineHeight: 1.43,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    marginBottom: 16,
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
    paddingVertical: 12,
  },
  colDescription: {
    width: '45%',
  },
  colQuantity: {
    width: '18%',
    textAlign: 'right',
  },
  colUnitPrice: {
    width: '18%',
    textAlign: 'right',
  },
  colTotal: {
    width: '19%',
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
    fontSize: 10,
    lineHeight: 1.43,
  },
  tableTextBold: {
    fontSize: 10,
    fontWeight: 'normal',
    lineHeight: 1.43,
  },
  subDescription: {
    fontSize: 8,
    color: '#71717A',
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
    fontSize: 10,
    fontWeight: 'bold',
    color: '#71717A',
    marginRight: 32,
    lineHeight: 1.43,
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 1.33,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 0,
  },
  kleinunternehmer: {
    fontSize: 8,
    color: '#71717A',
    fontStyle: 'italic',
    marginBottom: 16,
    lineHeight: 1.33,
  },
  footerDividerContainer: {
    borderTopWidth: 1,
    borderTopColor: '#000000',
    paddingTop: 20,
  },
  bankSectionLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#B3B3B3',
    letterSpacing: 0.5,
    marginBottom: 12,
    lineHeight: 1.33,
  },
  bankDetails: {
    marginTop: 0,
  },
  bankDetailRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bankLabel: {
    fontSize: 10,
    color: '#71717A',
    width: 140,
    marginRight: 16,
    lineHeight: 1.43,
  },
  bankValue: {
    fontSize: 10,
    flex: 1,
    lineHeight: 1.43,
  },
  bankValueBold: {
    fontSize: 10,
    fontWeight: 'bold',
    flex: 1,
    lineHeight: 1.43,
  },
});

export function InvoicePDF({ invoice, settings }: InvoicePDFProps) {
  const {
    invoiceNumber,
    date,
    servicePeriodStart,
    servicePeriodEnd,
    client,
    lineItems,
    total,
    paymentTerms,
  } = invoice;

  const isKleinunternehmer = settings.preferences.isKleinunternehmer;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Rechnung</Text>
            <Text style={styles.invoiceNumber}>Nr. {invoiceNumber}</Text>
          </View>

          {/* Bold Divider before items */}
          <View style={styles.headerDivider} />

          {/* Address Section */}
          <View style={styles.addressSection}>
            {/* From */}
            <View style={styles.addressBlock}>
              <Text style={styles.sectionLabel}>VON</Text>
              <Text style={styles.addressName}>{settings.name}</Text>
              <Text style={styles.addressText}>{settings.street}</Text>
              <Text style={styles.addressText}>
                {`${settings.postalCode} ${settings.city}`}
              </Text>
              {settings.taxNumber && (
                <Text style={styles.taxNumber}>
                  Steuernummer: {settings.taxNumber}
                </Text>
              )}
              {settings.taxNumberPending && !settings.taxNumber && (
                <Text style={styles.taxNumber}>
                  Steuernummer: wird beantragt
                </Text>
              )}
            </View>

            {/* To */}
            <View style={styles.addressBlock}>
              <Text style={styles.sectionLabel}>AN</Text>
              <Text style={styles.addressName}>{client.name}</Text>
              <Text style={styles.addressText}>{client.street}</Text>
              <Text style={styles.addressText}>
                {`${client.postalCode} ${client.city}`}
              </Text>
            </View>
          </View>

          {/* Meta Section */}
          <View style={styles.metaSection}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>RECHNUNGSDATUM</Text>
              <Text style={styles.metaValue}>{formatDate(date)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>LEISTUNGSZEITRAUM</Text>
              <Text style={styles.metaValue}>
                {formatDateRange(servicePeriodStart, servicePeriodEnd)}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>ZAHLUNGSZIEL</Text>
              <Text style={styles.metaValue}>{`${paymentTerms} Tage`}</Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Line Items Table */}
          <View style={styles.table}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.colDescription]}>
                LEISTUNG
              </Text>
              <Text style={[styles.tableHeaderText, styles.colQuantity]}>
                MENGE
              </Text>
              <Text style={[styles.tableHeaderText, styles.colUnitPrice]}>
                EINZELPREIS
              </Text>
              <Text style={[styles.tableHeaderText, styles.colTotal]}>
                BETRAG
              </Text>
            </View>

            {/* Table Rows */}
            {lineItems.map((item) => (
              <View key={item.id} style={styles.tableRow}>
                <View style={styles.colDescription}>
                  <Text style={styles.tableTextBold}>{item.description}</Text>
                  {item.subDescription && (
                    <Text style={styles.subDescription}>
                      {item.subDescription}
                    </Text>
                  )}
                </View>
                <Text style={[styles.tableText, styles.colQuantity]}>
                  {`${item.quantity} ${item.unit}`}
                </Text>
                <Text style={[styles.tableText, styles.colUnitPrice]}>
                  {formatCurrency(item.unitPrice)}
                </Text>
                <Text style={[styles.tableTextBold, styles.colTotal]}>
                  {formatCurrency(item.total)}
                </Text>
              </View>
            ))}
          </View>

          {/* Total */}
          <View style={styles.totalSection}>
            <Text style={styles.totalLabel}>Gesamt</Text>
            <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {/* Kleinunternehmer Clause */}
          {isKleinunternehmer && (
            <Text style={styles.kleinunternehmer}>
              Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.
            </Text>
          )}

          {/* Footer Divider and Bank Details */}
          <View style={styles.footerDividerContainer}>
            <Text style={styles.bankSectionLabel}>BANKVERBINDUNG</Text>
            <View style={styles.bankDetails}>
              <View style={styles.bankDetailRow}>
                <Text style={styles.bankLabel}>Kontoinhaber:</Text>
                <Text style={styles.bankValue}>
                  {settings.bankDetails.accountHolder}
                </Text>
              </View>
              <View style={styles.bankDetailRow}>
                <Text style={styles.bankLabel}>Bank:</Text>
                <Text style={styles.bankValue}>
                  {settings.bankDetails.bankName}
                </Text>
              </View>
              <View style={styles.bankDetailRow}>
                <Text style={styles.bankLabel}>IBAN:</Text>
                <Text style={styles.bankValue}>
                  {settings.bankDetails.iban}
                </Text>
              </View>
              <View style={styles.bankDetailRow}>
                <Text style={styles.bankLabel}>BIC:</Text>
                <Text style={styles.bankValue}>
                  {settings.bankDetails.bic}
                </Text>
              </View>
              <View style={styles.bankDetailRow}>
                <Text style={styles.bankLabel}>Verwendungszweck:</Text>
                <Text style={styles.bankValue}>{invoiceNumber}</Text>
              </View>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
