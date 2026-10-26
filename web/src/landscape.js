import {emptyItem,SECTIONS} from './core.js';
const center=w=>(w.x0+w.x1)/2;
const cy=w=>(w.y0+w.y1)/2;
const clean=s=>s.trim().replace(/[−–—]/g,'-');
export function landscapeHeader(words,lines=[]) {
  const candidates=words.filter(w=>center(w)>.35&&center(w)<.93&&cy(w)<.25&&/^(-|\d{2,3})$/.test(clean(w.text)));
  let labels=[];
  for(const w of candidates){const row=candidates.filter(v=>Math.abs(cy(v)-cy(w))<.012).sort((a,b)=>center(a)-center(b));if(row.length>labels.length)labels=row;}
  if(labels.length<2||!labels.some(w=>clean(w.text)==='-'))return null;
  const executions=labels.map(w=>clean(w.text));
  if(new Set(executions).size!==executions.length)return null;
  const centers=labels.map(center),spacing=centers[1]-centers[0];
  if(spacing<.012||spacing>.13||centers.slice(1).some((x,i)=>Math.abs((x-centers[i])-spacing)>spacing*.25))return null;
  if(lines.length&&centers.slice(1).some((x,i)=>lines.filter(line=>line>centers[i]+.005&&line<x-.005).length!==1))return null;
  const label=(regex,fallback)=>center(words.find(w=>cy(w)<.25&&regex.test(w.text))??{x0:fallback,x1:fallback});
  const before=(x,fallback)=>lines.filter(v=>v<x-.015).at(-1)??fallback;
  const codeLeft=before(label(/Обозначение/i,.18),.067),nameLeft=before(label(/Наименование/i,.40),.30);
  const noteLeft=before(label(/Примечание/i,.90),.84);
  return {executions,centers,spacing,codeLeft,nameLeft,noteLeft,quantityLeft:centers[0]-spacing/2,top:Math.max(...labels.map(w=>w.y1))+.01,bottom:words.some(w=>/Разраб/.test(w.text))?.72:.88};
}
export function parseLandscape(words,layout,section,page){
  const rows=[];
  for(const w of [...words].sort((a,b)=>cy(a)-cy(b)||a.x0-b.x0)){
    if(cy(w)<=layout.top||cy(w)>=layout.bottom||center(w)<layout.codeLeft-.035||center(w)>.97)continue;
    if(!rows.length||Math.abs(cy(w)-rows.at(-1).y)>.012)rows.push({y:cy(w),words:[]});
    rows.at(-1).words.push(w);
  }
  const items=[];let active=null,prefix='';
  for(const row of rows){
    const cells={position:[],code:[],name:[],note:[]},q=layout.executions.map(()=>[]);
    for(const w of row.words.sort((a,b)=>a.x0-b.x0)){
      const x=center(w);
      if(x<layout.codeLeft)cells.position.push(w.text);
      else if(x<layout.nameLeft)cells.code.push(w.text);
      else if(x<layout.quantityLeft)cells.name.push(w.text);
      else if(x>=layout.noteLeft)cells.note.push(w.text);
      else {const index=layout.centers.findIndex(c=>Math.abs(c-x)<layout.spacing*.48);if(index>=0)q[index].push(w.text);else if(/[0-9xх]/i.test(w.text))throw Error(`Лист ${page}: есть количество в колонке без распознанного исполнения. Проверьте шапку таблицы.`);}
    }
    const text=Object.fromEntries(Object.entries(cells).map(([key,parts])=>[key,parts.join(' ').trim()]));
    const header=SECTIONS.find(s=>text.name.toLowerCase().includes(s.toLowerCase()));
    if(header){section=header;active=null;prefix='';continue;}
    const quantities=q.map(parts=>clean(parts.join('')).replace(/\s/g,''));
    const hasValues=quantities.some(v=>/^(\d+(?:[.,]\d+)?|[xх-])$/i.test(v));
    if(text.code&&!/[\p{L}\p{N}]/u.test(text.code))text.code='';
    if((text.name||text.code)&&(hasValues||/^\d+$/.test(text.position)||(section==='Документация'&&text.code&&text.name))){
      if(prefix){const stem=prefix.match(/^[\p{L}]+/u)?.[0]?.slice(0,-2).toLowerCase();if(!stem||!text.name.toLowerCase().startsWith(stem))prefix='';}
      const unit=({M:'м',m:'м','М':'м'})[text.note]??text.note;
      const recognized=['м','кг','г','мм','л','м2','м²','м3','м³'].includes(unit);
      active={...emptyItem(),section,position:text.position.replace(/\D/g,''),code:text.code,name:[text.name,prefix].filter(Boolean).join(' '),quantity:'',quantities:Object.fromEntries(layout.executions.map((e,i)=>[e,quantities[i]])),unit:recognized?unit:section==='Материалы'?'':'шт.',note:recognized?'':text.note,page};
      items.push(active);
    }else if(/[\p{L}\p{N}]/u.test(text.name+text.code)){
      // A separated heading describes following rows (e.g. a shared tube standard).
      if(active&&row.y-(active.lastY??0)<.06){
        if(text.name)active.name+=' '+text.name;
        if(text.code)active.code+=' '+text.code;
        if(text.note)active.note=[active.note,text.note].filter(Boolean).join(' ');
      }else {prefix=[prefix,text.name].filter(Boolean).join(' ');active=null;}
    }
    if(active)active.lastY=row.y;
  }
  for(const item of items){
    delete item.lastY;
    if(['Материалы','Стандартные изделия','Прочие изделия'].includes(item.section)&&!item.code){
      const match=item.name.match(/\s+((?:ГОСТ|ОСТ\S*|ТУ)\s*\d[\p{L}\p{N} .\-/]*)$/u);
      if(match){item.code=match[1].trim();item.name=item.name.slice(0,match.index).trim();}
    }
  }
  return {items,section};
}
