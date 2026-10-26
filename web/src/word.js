import JSZip from 'jszip';
import { fmt, SECTIONS } from './core.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml=s => new DOMParser().parseFromString(s,'application/xml');
const children=(el,name)=>[...el.children].filter(n=>n.namespaceURI===W&&n.localName===name);
const first=(el,name)=>el.getElementsByTagNameNS(W,name)[0];
const serialize=doc=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+new XMLSerializer().serializeToString(doc.documentElement);
function wrap(text,max) {
  const lines=[];let line='';
  for(let word of String(text).split(/\s+/).filter(Boolean)) {
    if(line && line.length+word.length+1>max){lines.push(line);line='';}
    while(word.length>max){if(line){lines.push(line);line='';}lines.push(word.slice(0,max));word=word.slice(max);}
    if(word)line+=(line?' ':'')+word;
  }
  if(line||!lines.length)lines.push(line);
  return lines;
}
export function reportPages(groups) {
  const blocks=[];let previous='';
  for(const g of groups) {
    const i=g.item, rows=[];
    if(previous!==i.section){rows.push(['',i.section,'','','','','']);previous=i.section;}
    let index=0;
    const details=g.usageDetails ? [...g.usageDetails.values()] : [...g.usages].map(([path,quantity])=>({path,quantity,item:i}));
    for(const {path,quantity,item:source} of details) {
      const cells=['',index===0||g.variants?source.name:'',index===0?i.code:'',source.supplier,path,i.section==='Документация'?'':fmt(quantity),[i.unit==='шт.'?'':i.unit,source.note].filter(Boolean).join(' ')];
      const parts=cells.map((c,n)=>wrap(c,[3,27,26,27,25,7,31][n]));
      for(let n=0;n<Math.max(...parts.map(p=>p.length));n++)rows.push(parts.map(p=>p[n]??''));
      index++;
    }
    if(index>1&&i.section!=='Документация')rows.push(['','','','','','='+fmt(g.total),i.unit==='шт.'?'':i.unit]);
    rows.push(['','','','','','','']);blocks.push(rows);
  }
  const pages=[[]];
  for(const block of blocks) {
    let capacity=pages.length===1?23:29;
    if(pages.at(-1).length && block.length<=29 && pages.at(-1).length+block.length>capacity)pages.push([]);
    for(const row of block) {
      capacity=pages.length===1?23:29;
      if(pages.at(-1).length===capacity)pages.push([]);
      pages.at(-1).push(row);
    }
  }
  return pages;
}
export async function exportWord(groups, meta={}) {
  if(!groups.length)throw Error('Нет позиций для выгрузки.');
  const response=await fetch(new URL('template.docx',document.baseURI));
  if(!response.ok)throw Error('Не найден шаблон Word. Подготовьте офлайн-режим заново.');
  const zip=await JSZip.loadAsync(await response.arrayBuffer());
  const doc=xml(await zip.file('word/document.xml').async('string'));
  const body=first(doc,'body'), table=children(body,'tbl')[0], proto=children(table,'tr')[0].cloneNode(true);
  children(table,'tr').forEach(r=>r.remove());
  const anchor=table.nextSibling,reportNodes=[table];
  const pages=reportPages(groups);
  for(let pi=0;pi<pages.length;pi++) {
    let pageTable=table;
    if(pi>0){
      const paragraph=doc.createElementNS(W,'w:p');
      const properties=doc.createElementNS(W,'w:pPr');
      const spacing=doc.createElementNS(W,'w:spacing');
      for(const [key,value] of [['before','0'],['after','0'],['line','1'],['lineRule','exact']])spacing.setAttributeNS(W,'w:'+key,value);
      properties.append(spacing);paragraph.append(properties);
      const run=doc.createElementNS(W,'w:r'),br=doc.createElementNS(W,'w:br');br.setAttributeNS(W,'w:type','page');run.append(br);paragraph.append(run);
      pageTable=table.cloneNode(true);children(pageTable,'tr').forEach(r=>r.remove());
      body.insertBefore(paragraph,anchor);body.insertBefore(pageTable,anchor);reportNodes.push(paragraph,pageTable);
    }
    const capacity=pi===0?23:29;
    for(let n=0;n<capacity;n++) {
      const row=proto.cloneNode(true), values=pages[pi][n]??['','','','','','',''];
      const cells=children(row,'tc');
      cells.forEach((cell,k)=>{
        const t=first(cell,'t');t.textContent=k===0?String(n+1):values[k];t.setAttribute('xml:space','preserve');
        if(k===1&&SECTIONS.includes(values[k])) {
          const rPr=first(cell,'rPr')??first(cell,'r').insertBefore(doc.createElementNS(W,'w:rPr'),first(cell,'t'));
          const underline=doc.createElementNS(W,'w:u');underline.setAttributeNS(W,'w:val','single');rPr.append(underline);
        }
      });
      first(row,'trHeight').setAttributeNS(W,'w:hRule','exact');
      pageTable.append(row);
    }
  }
  // Original form: a landscape TVK section followed by the change-register sheet.
  if(!meta.changeSheet) {
    const section=[...body.getElementsByTagNameNS(W,'sectPr')][0].cloneNode(true);
    for(const node of [...body.children])if(!reportNodes.includes(node))node.remove();
    body.append(section);
  }
  const totalPages=pages.length+(meta.changeSheet?1:0);
  zip.file('word/document.xml',serialize(doc));
  for(const filename of Object.keys(zip.files).filter(n=>/^word\/(header|footer)\d+\.xml$/.test(n))) {
    const part=xml(await zip.file(filename).async('string'));
    for(const t of part.getElementsByTagNameNS(W,'t')) {
      t.textContent=t.textContent.replaceAll('{{designation}}',meta.designation||'Ведомость ТВК').replaceAll('{{title}}',meta.title||'Изделие').replaceAll('{{version}}',meta.version||'Версия 0').replaceAll('{{date}}',meta.date||'');
    }
    // Keep dynamic fields, update cached NUMPAGES values for viewers before refresh.
    for(const instr of part.getElementsByTagNameNS(W,'instrText')) {
      if(!instr.textContent.includes('NUMPAGES'))continue;
      let sibling=instr.parentElement.nextElementSibling;
      while(sibling) {
        const text=first(sibling,'t');
        if(text){text.textContent=String(totalPages);break;}
        sibling=sibling.nextElementSibling;
      }
    }
    zip.file(filename,serialize(part));
  }
  const settings=xml(await zip.file('word/settings.xml').async('string'));
  let update=first(settings,'updateFields');
  if(!update){update=settings.createElementNS(W,'w:updateFields');settings.documentElement.append(update);}
  update.setAttributeNS(W,'w:val','true');zip.file('word/settings.xml',serialize(settings));
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
}
