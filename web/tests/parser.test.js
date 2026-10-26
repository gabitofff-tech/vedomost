import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWords} from '../src/parser.js';
const word=(text,x,y=.3)=>({text,x0:x,y0:y,x1:x+.025,y1:y+.01});
const bounds=[.2,.52,.81,.86];
test('a missing material unit stays unknown, never defaults to pieces',()=>{
  const {items}=parseWords([word('1',.17),word('Провод',.55),word('3,8',.82)],bounds,'Материалы',1,true);
  assert.equal(items.length,1);assert.equal(items[0].quantity,'3,8');assert.equal(items[0].unit,'');
});
test('Latin M in the dedicated unit column is normalized to metres',()=>{
  const {items}=parseWords([word('1',.17),word('Провод',.55),word('1',.82),word('M',.9)],bounds,'Материалы',1,true);
  assert.equal(items[0].unit,'м');assert.equal(items[0].note,'');
});
test('standard designation on a continuation line stays with the item',()=>{
  const {items}=parseWords([word('1',.17),word('Провод',.55),word('1',.82),word('м',.9),word('ГОСТ',.55,.33),word('123-45',.64,.33)],bounds,'Материалы',2,false);
  assert.equal(items[0].code,'ГОСТ 123-45');assert.equal(items[0].name,'Провод');assert.equal(items[0].page,2);
});

test('OCR suffix-only rows are separate positions, including split dash tokens',()=>{
  for(const ocr of [false,true]){
    const {items}=parseWords([word('1',.17),word('AB.123.456',.25),word('Корпус',.55),word('2',.82),word('-',.25,.33),word('01',.29,.33),word('3',.82,.33)],bounds,'Детали',1,ocr);
    assert.equal(items.length,2);assert.equal(items[0].code,'AB.123.456');assert.equal(items[1].code,'-01');assert.equal(items[1].quantity,'3');
  }
});
test('suffix without quantity remains a separate position needing review',()=>{
  const {items}=parseWords([word('1',.17),word('AB.123.456',.25),word('Корпус',.55),word('2',.82),word('-01',.25,.33)],bounds,'Сборочные единицы',1,true);
  assert.equal(items.length,2);assert.equal(items[1].quantity,'');
});
