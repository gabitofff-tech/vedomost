import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, PSM } from 'tesseract.js';
import { normalizeAssembly } from './core.js';
import {landscapeHeader,parseLandscape} from './landscape.js';
import { parseWords } from './parser.js';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const local = path => new URL(path, document.baseURI).href;


function prepareImage(canvas) {
  const ctx=canvas.getContext('2d',{willReadFrequently:true}), {width:w,height:h}=canvas;
  const image=ctx.getImageData(0,0,w,h), dark=new Uint8Array(w*h);
  for (let i=0;i<dark.length;i++) dark[i]=(image.data[i*4]+image.data[i*4+1]+image.data[i*4+2])/3<150;
  const lines=[];
  for (let x=0;x<w;x++) {
    let sum=0; for(let y=Math.floor(h*.08);y<h*.72;y++) sum+=dark[y*w+x];
    if(sum/(h*.64)>.64) {
      if (lines.length && x-lines.at(-1).end<=3) {lines.at(-1).end=x;}
      else lines.push({start:x,end:x});
    }
  }
  const candidates=lines.map(r=>(r.start+r.end)/2/w);
  const boundary=(lo,hi,d) => candidates.filter(x=>x>lo&&x<hi).sort((a,b)=>Math.abs(a-d)-Math.abs(b-d))[0]??d;
  const bounds=[boundary(.16,.24,.20),boundary(.46,.57,.52),boundary(.77,.84,.81),boundary(.84,.90,.86)];
  function clear(x,y) { if(x>=0&&x<w&&y>=0&&y<h) {const k=(y*w+x)*4; image.data[k]=image.data[k+1]=image.data[k+2]=255;}}
  for (let y=0;y<h;y++) {
    let start=-1;
    for (let x=0;x<=w;x++) {
      if(x<w&&dark[y*w+x]) {if(start<0)start=x;} else if(start>=0) {
        if(x-start>w*.10) for(let dx=start-2;dx<x+2;dx++) for(let dy=y-2;dy<=y+2;dy++) clear(dx,dy);
        start=-1;
      }
    }
  }
  for(let x=0;x<w;x++) {
    let start=-1;
    for(let y=0;y<=h;y++) {
      if(y<h&&dark[y*w+x]) {if(start<0)start=y;} else if(start>=0) {
        if(y-start>h*.045) for(let dy=start-2;dy<y+2;dy++) for(let dx=x-2;dx<=x+2;dx++) clear(dx,dy);
        start=-1;
      }
    }
  }
  ctx.putImageData(image,0,0);
  bounds.lines=candidates;
  return bounds;
}

export async function importPDF(file, progress, signal) {
  const a={code:file.name.replace(/\.pdf$/i,''),name:file.name.replace(/\.pdf$/i,''),source:file.name,items:[],reviewed:false,root_quantity:'1',warnings:['Сверьте обозначение сборки с основной надписью PDF. Сейчас использовано имя файла. Проверьте все страницы и количества перед подтверждением.']};
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:local('pdf/cmaps/'),cMapPacked:true,standardFontDataUrl:local('pdf/standard_fonts/'),wasmUrl:local('pdf/wasm/'),useSystemFonts:true,isEvalSupported:false});
  let worker, doc, section='Детали';
  const abort=()=>{task.destroy(); worker?.terminate();};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    doc=await task.promise;
    for(let n=1;n<=doc.numPages;n++) {
      if(signal?.aborted) throw Error('Импорт отменён.');
      progress(`${file.name} · лист ${n} из ${doc.numPages}`);
      const page=await doc.getPage(n), viewport=page.getViewport({scale:3});
      const canvas=document.createElement('canvas'); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
      if(canvas.width*canvas.height>24000000) throw Error('Слишком большой лист PDF. Сохраните его в масштабе А4.');
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const text=await page.getTextContent(), words=[];
      const bounds=prepareImage(canvas);
      for(const item of text.items) {
        if(!item.str?.trim())continue;
        const tx=pdfjs.Util.transform(viewport.transform,item.transform), height=Math.hypot(tx[2],tx[3]);
        // PDF.js may return an entire row as one text item. Split on spaces proportionally.
        const parts=[...item.str.matchAll(/\S+/g)];
        for (const part of parts) {
          const x0=tx[4]+(part.index/item.str.length)*item.width*3;
          const x1=x0+(part[0].length/item.str.length)*item.width*3;
          words.push({x0:x0/canvas.width,y0:(tx[5]-height)/canvas.height,x1:x1/canvas.width,y1:tx[5]/canvas.height,text:part[0]});
        }
      }
      const ocr=words.length<=20,isLandscape=viewport.width>viewport.height*1.1;
      let layout=isLandscape?landscapeHeader(words,bounds.lines):null;
      if(isLandscape&&!layout){
        if(!worker)worker=await createWorker(['rus','eng'],1,{workerPath:local('ocr/worker.min.js'),corePath:local('ocr/core/'),langPath:local('ocr/lang/'),gzip:true,workerBlobURL:false,cacheMethod:'none'});
        await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
        progress(`${file.name} · лист ${n} · колонки исполнений`);
        const result=await worker.recognize(canvas,{}, {tsv:true,text:true}),headerWords=[];
        for(const line of (result.data.tsv??'').trim().split('\n').slice(1)){
          const c=line.split('\t');if(c.length<12||!c[11].trim()||Number(c[10])<0)continue;
          const [x,y,w,h]=c.slice(6,10).map(Number);headerWords.push({x0:x/canvas.width,y0:y/canvas.height,x1:(x+w)/canvas.width,y1:(y+h)/canvas.height,text:c.slice(11).join('\t')});
        }
        // Read each header cell separately: whole-page OCR can omit 01 or 05.
        const lines=bounds.lines.filter(x=>x>.4&&x<.9).sort((a,b)=>a-b);let grid=[];
        for(let start=0;start<lines.length-2;start++){
          const step=lines[start+1]-lines[start];if(step<.015||step>.08)continue;
          const run=[lines[start],lines[start+1]];
          for(let k=start+2;k<lines.length&&Math.abs(lines[k]-run.at(-1)-step)<step*.2;k++)run.push(lines[k]);
          if(run.length>grid.length)grid=run;
        }
        const anchors=headerWords.filter(w=>(w.x0+w.x1)/2>.45&&(w.y0+w.y1)/2<.2&&/^(?:-|[0-9]{2})$/.test(w.text.trim()));
        if(grid.length>=3&&anchors.length){
          const headerY=anchors.map(w=>(w.y0+w.y1)/2).sort((a,b)=>a-b)[Math.floor(anchors.length/2)],cellWords=[];
          for(let k=0;k<grid.length-1;k++){
            let value='';
            for(const [mode,height] of [[PSM.SINGLE_WORD,.042],[PSM.SINGLE_LINE,.030]]){
              await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:'0123456789-'});
              const crop=document.createElement('canvas');crop.width=Math.max(1,Math.floor((grid[k+1]-grid[k])*canvas.width)-10);crop.height=Math.floor(height*canvas.height);
              crop.getContext('2d').drawImage(canvas,Math.floor(grid[k]*canvas.width)+5,Math.floor((headerY-height/2)*canvas.height),crop.width,crop.height,0,0,crop.width,crop.height);
              const cell=await worker.recognize(crop),read=cell.data.text.trim().replace(/\s/g,'');crop.width=crop.height=1;
              if((k===0&&read==='-')||/^\d{2,3}$/.test(read)){value=read;break;}
            }
            cellWords.push({text:value,x0:grid[k]+.002,x1:grid[k+1]-.002,y0:headerY-.005,y1:headerY+.005});
          }
          layout=landscapeHeader([...headerWords.filter(w=>(w.y0+w.y1)/2<.11),...cellWords],bounds.lines);
        }else layout=null;
        if(!layout)throw Error(`Лист ${n}: не удалось определить колонки исполнений горизонтальной спецификации. Необходимо проверить шапку таблицы.`);
      }
      if(layout){
        if(a.executions&&JSON.stringify(a.executions)!==JSON.stringify(layout.executions))throw Error(`Лист ${n}: набор колонок исполнений отличается от предыдущих страниц. Разделите документ или уточните шапку.`);
        a.executions=layout.executions;a.root_execution=a.executions[0];
      }
      if(ocr) {
        words.length=0;
        if(!worker) worker=await createWorker(['rus','eng'],1,{workerPath:local('ocr/worker.min.js'),corePath:local('ocr/core/'),langPath:local('ocr/lang/'),gzip:true,workerBlobURL:false,cacheMethod:'none'});
        await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:''});
        a.warnings.push(`Лист ${n}: распознан скан. Возможны ошибки в буквах, цифрах и пропущенные позиции.`);
        const limits=layout?[layout.codeLeft-.035,layout.codeLeft,layout.nameLeft,layout.quantityLeft,...layout.centers.slice(1).map(c=>c-layout.spacing/2),layout.centers.at(-1)+layout.spacing/2,layout.noteLeft,.96]:[bounds[0]-.05,...bounds,.95];
        for(let col=0;col<limits.length-1;col++) {
          if(signal?.aborted)throw Error('Импорт отменён.');
          progress(`${file.name} · лист ${n} · распознавание ${col+1}/${limits.length-1}`);
          const x=Math.floor(limits[col]*canvas.width)+5,y=Math.floor((layout?.top??.10)*canvas.height),w=Math.floor(limits[col+1]*canvas.width)-5-x,h=Math.floor((layout?.bottom??.765)*canvas.height)-y;
          const crop=document.createElement('canvas');crop.width=w;crop.height=h;
          crop.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
          if(layout)await worker.setParameters({tessedit_char_whitelist:col>=3&&col<3+layout.executions.length?'0123456789.,-XХxх':''});
          const result=await worker.recognize(crop,{}, {tsv:true,text:true});
          const lines=(result.data.tsv??'').trim().split('\n');
          for (const line of lines.slice(1)) {
            const cells=line.split('\t'); if(cells.length<12||!cells[11].trim()||Number(cells[10])<0)continue;
            const [left,top,width,height]=cells.slice(6,10).map(Number);
            words.push({x0:(left+x)/canvas.width,y0:(top+y)/canvas.height,x1:(left+x+width)/canvas.width,y1:(top+y+height)/canvas.height,text:cells.slice(11).join('\t')});
          }
          crop.width=crop.height=1;
        }
      }
      const parsed=layout?parseLandscape(words,layout,section,n):parseWords(words,bounds,section,n,ocr);section=parsed.section;a.items.push(...parsed.items);
      if(!parsed.items.length)a.warnings.push(`Лист ${n}: позиции не выделены. Проверьте исходник и добавьте их вручную.`);
      canvas.width=canvas.height=1;page.cleanup();
    }
    if(a.executions)a.warnings.push('Групповая спецификация: «—» — базовое изделие, остальные колонки — исполнения. Проверьте каждую колонку; пустое количество требует уточнения, прочерк исключает позицию. Для отдельного изделия выберите нужное исполнение в карточке.');
    return normalizeAssembly(a);
  } finally {signal?.removeEventListener('abort',abort); await worker?.terminate(); await task.destroy();}
}
