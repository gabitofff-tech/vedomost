import { emptyItem, SECTIONS } from './core.js';

export function parseWords(words, bounds, section, page, ocr) {
  const rows=[];
  for (const w of words.sort((a,b) => (a.y0+a.y1-b.y0-b.y1)/2 || a.x0-b.x0)) {
    const cy=(w.y0+w.y1)/2;
    if (cy <= .095 || cy >= .765 || w.x0 < bounds[0]-.055) continue;
    if (!rows.length || Math.abs(cy-rows.at(-1).y)>.007) rows.push({y:cy,words:[]});
    rows.at(-1).words.push(w);
  }
  const items=[]; let active=null;
  for (const row of rows) {
    const cells=['','','','',''];
    for (const w of row.words.sort((a,b) => a.x0-b.x0)) {
      if (!/[\p{L}\p{N}]/u.test(w.text) && !['*','★'].includes(w.text)) continue;
      const col=bounds.filter(b => (w.x0+w.x1)/2>=b).length;
      cells[col] = `${cells[col]} ${w.text}`.trim();
    }
    let [position,code,name,quantity,note]=cells;
    if (ocr && code && !/\d[.\-]\d|ГОСТ|ОСТ|ТУ/.test(code)) code='';
    const header=SECTIONS.find(s => name.toLowerCase().includes(s.toLowerCase()));
    if (header) {section=header; active=null; continue;}
    if ((!code && !name) || ['Наименование','Кол.'].includes(name)) continue;
    const docrow=section==='Документация' && code && name;
    if (/^\d{1,4}$/.test(position) || docrow || (name && /^\d+([.,]\d+)?$/.test(quantity))) {
      const canonical=({M:'м',m:'м','М':'м',kg:'кг',g:'г',mm:'мм',l:'л'})[note]??note;
      const recognizedUnit=['м','кг','г','мм','л','м2','м²','м3','м³'].includes(canonical);
      const unit=recognizedUnit?canonical:section==='Материалы'?'':'шт.';
      active={...emptyItem(),section,position,code,name,quantity:docrow?'0':quantity,unit,note:recognizedUnit?'':note,page};
      items.push(active);
    } else if (active) {
      if (/[\p{L}\p{N}]/u.test(name)) active.name+=` ${name}`;
      if (code) active.code+=` ${code}`;
      if (note) active.note=`${active.note} ${note}`.trim();
    }
  }
  for (const item of items) {
    if (['Материалы','Стандартные изделия'].includes(item.section) && !item.code) {
      const m=item.name.match(/\s+((?:ГОСТ|ОСТ\S*|ТУ)\s*\d[\p{L}\p{N} .\-/]*)$/u);
      if (m) {item.code=m[1].trim(); item.name=item.name.slice(0,m.index).trim();}
    }
  }
  return {items,section};
}
