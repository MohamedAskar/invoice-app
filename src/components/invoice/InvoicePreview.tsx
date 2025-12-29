import { Invoice, BusinessSettings } from '@/types/invoice';
import { formatCurrency, formatDate, formatDateRange } from '@/lib/formatting';

interface InvoicePreviewProps {
  invoice: Partial<Invoice>;
  settings: BusinessSettings;
}

export function InvoicePreview({ invoice, settings }: InvoicePreviewProps) {
  const {
    invoiceNumber = '',
    date = '',
    servicePeriodStart = '',
    servicePeriodEnd = '',
    client,
    lineItems = [],
    total = 0,
    paymentTerms = 14,
  } = invoice;

  const isKleinunternehmer = settings.preferences.isKleinunternehmer;

  // A4 aspect ratio: 210mm x 297mm = 1:1.414
  return (
    <div className="overflow-auto w-full">
      <div 
        className="bg-white border shadow-sm flex flex-col"
        style={{ 
          width: '800px', // Increased width for better readability
          height: '1131px', // Fixed height maintains A4 aspect ratio (1:1.414)
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div className="p-12 overflow-hidden flex flex-col h-full">
          {/* Main Content */}
          <div className="flex-1">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <h1 className="text-4xl font-bold tracking-tight">Rechnung</h1>
              <div className="text-right text-sm text-muted-foreground">
                Nr. {invoiceNumber || <span className="italic">Invoice number</span>}
              </div>
            </div>

            {/* Bold Divider before items */}
            <div className="border-t-2 border-gray-300 mb-12" />

            {/* Address Blocks */}
            <div className="grid grid-cols-2 gap-16 mb-12">
              {/* From */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#999] mb-3">
                  VON
                </p>
                <div className="space-y-0.5 text-sm break-words">
                  <p className="font-semibold break-words">{settings.name || <span className="italic text-muted-foreground">Your name</span>}</p>
                  <p className="break-words">{settings.street || <span className="italic text-muted-foreground">Street</span>}</p>
                  <p className="break-words">
                    {settings.postalCode || <span className="italic text-muted-foreground">PLZ</span>}{' '}
                    {settings.city || <span className="italic text-muted-foreground">City</span>}
                  </p>
                  {settings.taxNumber && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Steuernummer: {settings.taxNumber}
                    </p>
                  )}
                  {settings.taxNumberPending && !settings.taxNumber && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Steuernummer: wird beantragt
                    </p>
                  )}
                </div>
              </div>

              {/* To */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#999] mb-3">
                  AN
                </p>
                <div className="space-y-0.5 text-sm break-words">
                  <p className="font-semibold break-words">{client?.name || <span className="italic text-muted-foreground">Client name</span>}</p>
                  <p className="break-words">{client?.street || <span className="italic text-muted-foreground">Street</span>}</p>
                  <p className="break-words">
                    {client?.postalCode || <span className="italic text-muted-foreground">PLZ</span>}{' '}
                    {client?.city || <span className="italic text-muted-foreground">City</span>}
                  </p>
                </div>
              </div>
            </div>

            {/* Invoice Meta */}
            <div className="grid grid-cols-3 gap-8 mb-12">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#999] mb-2">
                  RECHNUNGSDATUM
                </p>
                <p className="text-sm font-medium">{date ? formatDate(date) : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#999] mb-2">
                  LEISTUNGSZEITRAUM
                </p>
                <p className="text-sm font-medium">
                  {servicePeriodStart && servicePeriodEnd
                    ? formatDateRange(servicePeriodStart, servicePeriodEnd)
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#999] mb-2">
                  ZAHLUNGSZIEL
                </p>
                <p className="text-sm font-medium">{paymentTerms} Tage</p>
              </div>
            </div>

            {/* Bold Divider before items */}
            <div className="border-t-2 border-gray-300 mb-6" />

            {/* Line Items */}
            <div className="mb-10">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: '45%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '19%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="pb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      LEISTUNG
                    </th>
                    <th className="pb-3 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      MENGE
                    </th>
                    <th className="pb-3 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      EINZELPREIS
                    </th>
                    <th className="pb-3 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      BETRAG
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-muted-foreground italic">
                        No items added
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item) => (
                      <tr key={item.id} className="border-b border-dashed">
                        <td className="py-4 break-words">
                          <p className="font-medium break-words">{item.description || '—'}</p>
                          {item.subDescription && (
                            <p className="text-xs text-muted-foreground mt-0.5 break-words">
                              {item.subDescription}
                            </p>
                          )}
                        </td>
                        <td className="py-4 text-right break-words">
                          {item.quantity} {item.unit}
                        </td>
                        <td className="py-4 text-right whitespace-nowrap">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="py-4 text-right font-medium whitespace-nowrap">
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Total */}
            <div className="flex justify-end mb-12">
              <div className="flex items-center gap-8">
                <span className="text-sm font-bold text-muted-foreground">Gesamt</span>
                <span className="text-2xl font-bold">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Footer Section */}
          <div className="mt-16">
            {/* Kleinunternehmer Clause */}
            {isKleinunternehmer && (
              <div className="mb-6 text-xs text-muted-foreground italic">
                <p>
                  Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.
                </p>
              </div>
            )}

            {/* Divider */}
            <div className="border-t-2 border-black pt-6">
              {/* Bank Details */}
              <p className="text-xs font-bold uppercase tracking-wider text-[#999] mb-4">
                BANKVERBINDUNG
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex gap-4">
                  <span className="text-muted-foreground min-w-[140px] flex-shrink-0">Kontoinhaber:</span>
                  <span className="break-words">{settings.bankDetails.accountHolder || <span className="text-muted-foreground">-</span>}</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-muted-foreground min-w-[140px] flex-shrink-0">Bank:</span>
                  <span className="break-words">{settings.bankDetails.bankName || <span className="text-muted-foreground">-</span>}</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-muted-foreground min-w-[140px] flex-shrink-0">IBAN:</span>
                  <span className="break-all">{settings.bankDetails.iban || <span className="text-muted-foreground">-</span>}</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-muted-foreground min-w-[140px] flex-shrink-0">BIC:</span>
                  <span className="break-words">{settings.bankDetails.bic || <span className="text-muted-foreground">-</span>}</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-muted-foreground min-w-[140px] flex-shrink-0">Verwendungszweck:</span>
                  <span className="font-medium break-words">{invoiceNumber || <span className="italic text-muted-foreground">Invoice number</span>}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
