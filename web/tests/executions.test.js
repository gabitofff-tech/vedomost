import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,buildStructure,validateProject,emptyItem,fmt} from '../src/core.js';
import {reportPages} from '../src/word.js';
import {landscapeHeader,parseLandscape} from '../src/landscape.js';
const part=(code,quantity='1',extra={})=>({...emptyItem(),code,name:code,quantity,...extra});
const sub=(code,q='1')=>part(code,q,{section:'Сборочные единицы'});
const a=(code,items,extra={})=>({code,name:code,root_quantity:'1',items,...extra});
const family=()=>a('S',[part('WIRE','',{section:'Материалы',unit:'м',quantities:{'-':'17','01':'17','02':'12'}}),part('D','',{quantities:{'-':'1','01':'-','02':'2'}})],{executions:['-','01','02'],root_execution:'-'});
test('one ordinary PDF resolves suffix assemblies without duplicate root counts',()=>{
 const r=aggregate([a('R',[sub('S-01','2'),sub('S-02','3')]),a('S',[part('D','4')])]);
 assert.deepEqual(r.roots,['R']);assert.deepEqual(r.warnings,[]);const d=r.groups.find(g=>g.item.code==='D');assert.equal(fmt(d.total),'20');assert.deepEqual([...d.usages.keys()],['S-01','S-02']);
 const tree=buildStructure([a('R',[sub('S-01','2')]),a('S',[part('D','4')])]);assert.equal(tree.roots.length,1);assert.equal(tree.roots[0].children[0].children[0].assemblyIndex,1);assert.equal(fmt(tree.roots[0].children[0].children[0].total),'8');
});
test('grouped quantities follow referenced executions and dash excludes a row',()=>{
 const r=aggregate([a('R',[sub('S-01','2'),sub('S-02','3')]),family()]);
 assert.deepEqual(r.warnings,[]);assert.deepEqual(r.roots,['R']);
 const wire=r.groups.find(g=>g.item.code==='WIRE'),d=r.groups.find(g=>g.item.code==='D');assert.equal(fmt(wire.total),'70');assert.equal(fmt(d.total),'6');assert.deepEqual([...d.usages.keys()],['S-02']);
 const tree=buildStructure([a('R',[sub('S-01')]),family()]);assert.equal(tree.roots[0].children[0].children.length,1);
});
test('standalone group counts only selected execution and survives JSON',()=>{
 const f=family();f.root_execution='02';const restored=validateProject({version:1,assemblies:[f]});
 assert.equal(restored[0].items[0].quantities['-'],'17');const r=aggregate(restored);assert.deepEqual(r.roots,['S-02']);assert.equal(fmt(r.groups.find(g=>g.item.code==='WIRE').total),'12');
 assert.equal(buildStructure(restored).roots[0].code,'S-02');
});
test('missing group execution is not replaced by base quantities',()=>{
 const r=aggregate([a('R',[sub('S-03')]),family()]);assert.ok(r.missingCodes.includes('S-03'));assert.deepEqual(r.roots,['R']);assert.equal(r.groups.some(g=>g.item.code==='WIRE'),false);
});
test('exact suffix specification overrides a plain common specification',()=>{
 const r=aggregate([a('R',[sub('S-01')]),a('S',[part('D','4')]),a('S-01',[part('D','7')])],['R']);assert.equal(fmt(r.groups.find(g=>g.item.code==='D').total),'7');
});
test('unknown grouped quantities block export, zero and dash do not invent quantities',()=>{
 for(const invalid of ['', 'abc','X']){const f=family();f.items[0].quantities['02']=invalid;assert.throws(()=>aggregate([f]));}
 const f=family();f.items[0].quantities['02']='0';f.root_execution='02';assert.equal(aggregate([f]).groups.some(g=>g.item.code==='WIRE'),false);
});
test('documentation X means presence, no count; dash means absence',()=>{
 const f=a('S',[part('DRAWING','',{section:'Документация',quantities:{'-':'X','01':'-'}})],{executions:['-','01'],root_execution:'-'});
 assert.equal(aggregate([f]).groups.length,1);f.root_execution='01';assert.equal(aggregate([f]).groups.length,0);
});
test('direct-parent applicability merges paths but retains the extended amount in Word',()=>{
 const r=aggregate([a('A',[sub('S','2')]),a('B',[sub('S','3')]),a('S',[part('D','4')])]);const d=r.groups.find(g=>g.item.code==='D');
 assert.equal(d.usages.size,1);assert.equal(fmt(d.usages.get('S')),'20');const rows=reportPages([d]).flat();assert.ok(rows.some(row=>row[4]==='S'&&row[5]==='20'));assert.ok(!rows.flat().some(c=>c.includes(' → ')));
});
test('cycles through common execution specifications are still rejected',()=>{
 assert.throws(()=>aggregate([a('S',[sub('S-01')])]),/Циклическая/);
});
const w=(text,x,y)=>({text,x0:x-.004,x1:x+.004,y0:y-.004,y1:y+.004});
const header=[w('Обозначение',.18,.12),w('Наименование',.4,.12),w('Примечание',.9,.12),w('-',.525,.14),w('01',.56,.14),w('02',.595,.14)];
test('landscape parser associates quantities with header labels, not column sums',()=>{
 const layout=landscapeHeader(header),words=[...header,w('Материалы',.4,.21),w('16',.05,.3),w('Провод',.4,.3),w('17',.525,.3),w('17',.56,.3),w('12',.595,.3),w('М',.9,.3)];
 const {items}=parseLandscape(words,layout,'Детали',1);assert.equal(items.length,1);assert.deepEqual(items[0].quantities,{'-':'17','01':'17','02':'12'});assert.equal(items[0].unit,'м');
});
test('blank and dash cells remain distinguishable during landscape parsing',()=>{
 const {items}=parseLandscape([...header,w('1',.05,.3),w('D',.18,.3),w('Деталь',.4,.3),w('2',.525,.3),w('-',.595,.3)],landscapeHeader(header),'Детали',1);
 assert.deepEqual(items[0].quantities,{'-':'2','01':'','02':'-'});
});

test('missing header cell or unlabelled quantity is rejected rather than shifted',()=>{
 assert.equal(landscapeHeader(header.filter(w=>w.text!=='01'),[.5075,.5425,.5775,.6125]),null);
 assert.throws(()=>parseLandscape([...header,w('D',.18,.3),w('Деталь',.4,.3),w('2',.7,.3)],landscapeHeader(header),'Детали',1),/без распознанного исполнения/);
});
test('a numbered row with unreadable quantities stays available for correction',()=>{
 const {items}=parseLandscape([...header,w('1',.05,.3),w('D',.18,.3),w('Деталь',.4,.3)],landscapeHeader(header),'Детали',1);
 assert.equal(items.length,1);assert.deepEqual(items[0].quantities,{'-':'','01':'','02':''});
});
