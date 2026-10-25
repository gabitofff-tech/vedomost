import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
const root=path.resolve('web/public');
await fs.mkdir(path.join(root,'ocr/core'),{recursive:true});
await fs.mkdir(path.join(root,'ocr/lang'),{recursive:true});
await fs.copyFile('node_modules/tesseract.js/dist/worker.min.js',path.join(root,'ocr/worker.min.js'));
for(const name of await fs.readdir('node_modules/tesseract.js-core'))if(name.includes('.wasm'))await fs.copyFile(path.join('node_modules/tesseract.js-core',name),path.join(root,'ocr/core',name));
for(const folder of ['cmaps','standard_fonts','wasm','iccs'])await fs.cp(`node_modules/pdfjs-dist/${folder}`,path.join(root,'pdf',folder),{recursive:true});
const manifest=JSON.parse(await fs.readFile('scripts/languages.json','utf8'));
for(const item of manifest) {
  const destination=path.join(root,'ocr/lang',item.name+'.traineddata.gz');
  let valid=false;
  try { const {gunzipSync}=await import('node:zlib');const data=gunzipSync(await fs.readFile(destination));valid=crypto.createHash('sha256').update(data).digest('hex')===item.sha256; }catch{}
  if(valid)continue;
  const response=await fetch(item.url);if(!response.ok)throw Error(`Cannot download ${item.name}: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error(`Checksum mismatch: ${item.name}`);
  await fs.writeFile(destination,gzipSync(bytes));
}
let notices='Third-party licenses for the Vedomost browser bundle.\nElectron includes its own LICENSE and LICENSES.chromium.html in the Windows package.\n\n';
for(const name of ['pdfjs-dist','tesseract.js','tesseract.js-core','jszip','decimal.js','pako','idb-keyval','regenerator-runtime','lie','immediate','setimmediate','is-electron','bmp-js','zstddec']) {
  const dir=path.join('node_modules',name);
  try{for(const filename of await fs.readdir(dir))if(/^licen[sc]e/i.test(filename)){notices+=`\n=== ${name} / ${filename} ===\n`+await fs.readFile(path.join(dir,filename),'utf8')+'\n';}}catch{}
}
notices+='\nLanguage data: tesseract-ocr/tessdata_fast (Apache License 2.0).\n';
await fs.writeFile(path.join(root,'THIRD-PARTY-LICENSES.txt'),notices);
console.log('Offline OCR, language models and PDF assets prepared.');
