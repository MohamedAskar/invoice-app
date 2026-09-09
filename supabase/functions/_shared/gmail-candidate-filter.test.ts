import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import { attachments, detectDocument, filterAttachment, senderOf, type GmailMessage, type MimePart, type VendorRule } from './gmail-candidate-filter.ts';
const message: GmailMessage = { id:'m', internalDate:'1788220800000', payload:{ headers:[{name:'From',value:'Vendor <BILLING@Supplier.Test>'},{name:'Subject',value:'Invoice'}] } };
const part: MimePart = { filename:'Invoice-123.pdf',mimeType:'application/pdf',body:{attachmentId:'a',size:100} };
const filter=(p:MimePart=part,m: GmailMessage=message,rules:VendorRule[]=[])=>filterAttachment(m,p,'me@example.test',rules,[]);
Deno.test('recursive MIME traversal and normalized sender metadata',()=>{
  equal(attachments({parts:[{parts:[part]}]}),[part]);
  equal(senderOf(message),{email:'billing@supplier.test',domain:'supplier.test',vendor:'Vendor'});
});
Deno.test('SENT, own sender and issued app invoices are excluded before download',()=>{
  equal(filter(part,{...message,labelIds:['SENT']}).reason,'sent_or_self');
  equal(filterAttachment(message,part,'billing@supplier.test',[],[]).reason,'sent_or_self');
  equal(filterAttachment(message,part,'me@example.test',[],[{invoice_number:'123'}]).reason,'issued_invoice');
});
Deno.test('unsafe, inline, and oversized attachments fail closed',()=>{
  for(const p of [{...part,filename:'Invoice.exe'}, {...part,filename:'Invoice.zip'}, {...part,mimeType:'text/html'}, {...part,body:{attachmentId:'x',size:16*1024*1024}}, {...part,headers:[{name:'Content-Disposition',value:'inline'}]}, {...part,headers:[{name:'Content-ID',value:'logo'}]}]) equal(filter(p).include,false);
});
Deno.test('vendor include and ignore rules remain deterministic with unrelated files excluded',()=>{
  const include:VendorRule={id:'rule',sender_domain:'supplier.test',vendor:null,action:'always_include'};
  equal(filter({...part,filename:'Terms.pdf'},message,[include]).include,false);
  equal(filter(part,message,[{...include,action:'ignore'}]).reason,'vendor_ignored');
  equal(filter({...part,filename:'document.pdf'},message,[include]).reason,'vendor_always_include');
  equal(filter({...part,filename:'Holiday.pdf'},{...message,payload:{headers:[{name:'From',value:'other@supplier.test'},{name:'Subject',value:'Summer photos'}]}}).include,false);
});
Deno.test('octet-stream requires a PDF filename and PDF signature; corrupt and mismatched files are rejected',()=>{
  const pdf=new TextEncoder().encode('%PDF-1.7\nsynthetic\n%%EOF');
  equal(detectDocument(pdf,{...part,mimeType:'application/octet-stream'}),'application/pdf');
  equal(detectDocument(pdf,{...part,mimeType:'application/octet-stream',filename:'Invoice.png'}),null);
  equal(detectDocument(new TextEncoder().encode('MZ executable'),part),null);
  equal(detectDocument(new TextEncoder().encode('%PDF-1.7 truncated'),part),null);
  equal(detectDocument(pdf,{...part,mimeType:'image/png',filename:'Invoice.png'}),null);
  ok(!detectDocument(new Uint8Array(16*1024*1024),part));
});
