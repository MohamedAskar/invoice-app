import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import { attachments, detectDocument, filterAttachment, senderOf, type GmailMessage, type MimePart, type VendorRule } from './gmail-candidate-filter.ts';
import { validPdf } from './gmail-test-fixtures.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import jpeg from 'npm:jpeg-js@0.4.4';
// @deno-types="npm:@types/pngjs@6.0.5"
import { PNG } from 'npm:pngjs@7.0.0';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
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

Deno.test('valid PDFs including compressed objects, JPEG and PNG pass structural checks while corrupt payloads fail closed', async () => {
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

Deno.test('PNG exact output budget rejects expansion, truncated streams and invalid filter bytes', async () => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const compressed = deflateSync(Buffer.from([0,255,255,255,255]));
  const payloads = [deflateSync(Buffer.alloc(8 * 1024 * 1024)), compressed.subarray(0, -1), deflateSync(Buffer.from([5,255,255,255,255])), Buffer.concat([compressed, Buffer.from([1])])];
  for (const payload of payloads) {
    const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', payload), pngChunk('IEND', new Uint8Array())]);
    equal(await detectDocument(png, {...part, filename:'Invoice.png', mimeType:'image/png'}), null);
  }
});

Deno.test('JPEG malformed segment lengths, excessive pixels and invalid scan parameters fail closed', async () => {
  const jpg = jpeg.encode({width:1,height:1,data:Buffer.from([255,255,255,255])}).data;
  const target = {...part, filename:'Invoice.jpg', mimeType:'image/jpeg'};
  const short = jpg.slice(); short[4] = 255; short[5] = 255;
  equal(await detectDocument(short, target), null);
  const large = jpg.slice();
  const frame = large.findIndex((byte, i) => byte === 255 && large[i+1] === 0xc0);
  ok(frame > 0); large[frame+5] = 255; large[frame+6] = 255;
  equal(await detectDocument(large, target), null);
  const scan = jpg.slice(), at = scan.findIndex((byte, i) => byte === 255 && scan[i+1] === 0xda);
  ok(at > 0); const end = at + 2 + scan[at+2] * 256 + scan[at+3]; scan[end-2] = 64;
  equal(await detectDocument(scan, target), null);
});

function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4); chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

Deno.test('small compressed PDF cannot expand unbounded object metadata', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([100, 100]);
  pdf.setTitle('a'.repeat(2 * 1024 * 1024));
  const bytes = await pdf.save();
  ok(bytes.length < 32 * 1024);
  equal(await detectDocument(bytes, part), null);
});

Deno.test('small interlaced PNG cannot inflate excessive scanline data', async () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1;
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.alloc(8 * 1024 * 1024))), pngChunk('IEND', new Uint8Array())]);
  ok(bytes.length < 16 * 1024);
  equal(await detectDocument(bytes, {...part, filename: 'Invoice.png', mimeType: 'image/png'}), null);
});

Deno.test('compressed PNG with excessive claimed height fails before pixel allocation', async () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(32768, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1;
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.alloc(5 * 32768))), pngChunk('IEND', new Uint8Array())]);
  ok(bytes.length < 1024);
  equal(await detectDocument(bytes, {...part, filename: 'Invoice.png', mimeType: 'image/png'}), null);
});
