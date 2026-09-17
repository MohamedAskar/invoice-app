import { validJpeg, validPdfStructure, validPng } from './document-structure.ts';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export interface MimePart {
  partId?: string; filename?: string; mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string }; parts?: MimePart[];
}
export interface GmailMessage { id: string; threadId?: string; labelIds?: string[]; internalDate: string; payload?: MimePart }
export interface VendorRule { id: string; sender_domain: string | null; vendor: string | null; action: 'always_include' | 'review' | 'ignore' }
export interface IssuedInvoice { invoice_number: string; pdf_storage_path?: string | null }
export type DetectedMime = 'application/pdf' | 'image/png' | 'image/jpeg';
const normalized = (s: string) => s.normalize('NFKC').toLowerCase().trim();
export function header(part: MimePart | undefined, name: string): string {
  return part?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
export function senderOf(message: GmailMessage) {
  const from = header(message.payload, 'from');
  const email = normalized(from.match(/<?([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+)>?/)?.[1] ?? '');
  const vendor = from.replace(/<[^>]*>/g, '').replace(/["\r\n]/g, '').trim().slice(0, 160) || email || 'Unknown sender';
  return { email, domain: email.split('@')[1] ?? '', vendor };
}
export function attachments(part?: MimePart): MimePart[] {
  if (!part) return [];
  return [...(part.filename ? [part] : []), ...(part.parts ?? []).flatMap(attachments)];
}
export const invoiceNamed = (filename: string) => /invoice|rechnung/i.test(filename);
export const receiptNamed = (filename: string) => /receipt|beleg|quittung/i.test(filename);
export function filterAttachment(message: GmailMessage, part: MimePart, mailbox: string, rules: VendorRule[], issued: IssuedInvoice[]) {
  const sender = senderOf(message), name = normalized(part.filename ?? '');
  const exclude = (reason: string) => ({ include: false, reason, ruleId: null as string | null });
  if (message.labelIds?.includes('SENT') || sender.email === normalized(mailbox)) return exclude('sent_or_self');
  if (!sender.email) return exclude('unknown_sender');
  if (!part.body?.attachmentId || /inline/i.test(header(part, 'content-disposition')) || header(part, 'content-id')) return exclude('inline_asset');
  if (!Number.isInteger(part.body.size) || part.body.size! <= 0 || part.body.size! > MAX_ATTACHMENT_BYTES) return exclude('invalid_size');
  if (!/\.(pdf|jpe?g|png)$/.test(name) || !['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream'].includes(part.mimeType ?? '') || (part.mimeType === 'application/octet-stream' && !name.endsWith('.pdf'))) return exclude('unsupported_document');
  const compact = (s: string) => normalized(s).replace(/[^a-z0-9]/g, '');
  if (issued.some(i => (i.invoice_number && compact(name).includes(compact(i.invoice_number))) || (i.pdf_storage_path && name === normalized(i.pdf_storage_path.split('/').pop() ?? '')))) return exclude('issued_invoice');
  const rule = rules.find(r => r.sender_domain === sender.domain) ?? rules.find(r => r.vendor === normalized(sender.vendor));
  if (rule?.action === 'ignore') return { ...exclude('vendor_ignored'), ruleId: rule.id };
  if (/terms|agb|privacy|datenschutz|returns|retoure|widerruf/i.test(name)) return exclude('unrelated_document');
  const reason = rule?.action === 'always_include' ? 'vendor_always_include' : invoiceNamed(name) ? 'invoice_filename' : receiptNamed(name) ? 'receipt_filename' : /invoice|rechnung|receipt|beleg|quittung/i.test(header(message.payload, 'subject')) ? 'invoice_subject' : rule?.action === 'review' ? 'vendor_review' : null;
  return { include: reason !== null, reason: reason ?? 'no_invoice_signal', ruleId: rule?.id ?? null };
}
export async function detectDocument(bytes: Uint8Array, part: MimePart): Promise<DetectedMime | null> {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) return null;
  const prefix = new TextDecoder().decode(bytes.subarray(0, 8));
  let mime: DetectedMime | null = null;
  if (/^%PDF-\d\.\d/.test(prefix) && new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes('%%EOF')) mime = 'application/pdf';
  else if (bytes.length > 24 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) && new TextDecoder().decode(bytes.subarray(12,16)) === 'IHDR' && new TextDecoder().decode(bytes.subarray(bytes.length - 8, bytes.length - 4)) === 'IEND') mime = 'image/png';
  else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) mime = 'image/jpeg';
  const extension = part.filename?.toLowerCase().split('.').pop();
  const declared = part.mimeType === 'application/octet-stream' && extension === 'pdf' ? 'application/pdf' : part.mimeType;
  if (!mime || mime !== declared || !((mime === 'application/pdf' && extension === 'pdf') || (mime === 'image/png' && extension === 'png') || (mime === 'image/jpeg' && ['jpg','jpeg'].includes(extension ?? '')))) return null;
  try {
    const valid = mime === 'application/pdf' ? validPdfStructure(bytes) : mime === 'image/jpeg' ? validJpeg(bytes) : validPng(bytes);
    return valid ? mime : null;
  } catch { return null; }
}
