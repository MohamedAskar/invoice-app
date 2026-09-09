import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import { attachments, detectDocument, filterAttachment, senderOf, type GmailMessage, type MimePart, type VendorRule } from './gmail-candidate-filter.ts';
import { validPdf } from './gmail-test-fixtures.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import jpeg from 'npm:jpeg-js@0.4.4';
// @deno-types="npm:@types/pngjs@6.0.5"
import { PNG } from 'npm:pngjs@7.0.0';
import { Buffer } from 'node:buffer';
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
Deno.test('octet-stream requires a PDF filename and PDF signature; corrupt and mismatched files are rejected',async()=>{
  const pdf=validPdf();
  equal(await detectDocument(pdf,{...part,mimeType:'application/octet-stream'}),'application/pdf');
  equal(await detectDocument(pdf,{...part,mimeType:'application/octet-stream',filename:'Invoice.png'}),null);
  equal(await detectDocument(new TextEncoder().encode('MZ executable'),part),null);
  equal(await detectDocument(new TextEncoder().encode('%PDF-1.7 truncated'),part),null);
  equal(await detectDocument(pdf,{...part,mimeType:'image/png',filename:'Invoice.png'}),null);
  ok(!await detectDocument(new Uint8Array(16*1024*1024),part));
});

Deno.test('PDF and JPEG sentinel-only corrupt files are rejected', async () => {
  equal(await detectDocument(new TextEncoder().encode('%PDF-1.7\nnot a document\n%%EOF'),part),null);
  equal(await detectDocument(new Uint8Array([255,216,255,0,0,255,217]),{...part,filename:'Invoice.jpg',mimeType:'image/jpeg'}),null);
});

Deno.test('valid PDFs including compressed objects, JPEG and PNG decode while corrupt image payloads fail closed', async () => {
  const pdf=await PDFDocument.create(); pdf.addPage([100,100]);
  equal(await detectDocument(await pdf.save(),part),'application/pdf');
  const rgba=Buffer.from([255,255,255,255]);
  const jpg=jpeg.encode({width:1,height:1,data:rgba}).data;
  const png=PNG.sync.write({width:1,height:1,data:rgba} as PNG);
  equal(await detectDocument(jpg,{...part,filename:'Invoice.jpg',mimeType:'image/jpeg'}),'image/jpeg');
  equal(await detectDocument(png,{...part,filename:'Invoice.png',mimeType:'image/png'}),'image/png');
  const broken=png.slice(); broken[broken.length-1]^=1;
  equal(await detectDocument(broken,{...part,filename:'Invoice.png',mimeType:'image/png'}),null);
});
