"""Heuristic ESKD reader. All imports require human review before export."""
import csv
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

import fitz
import numpy as np
from PIL import Image

from .model import Assembly, Item, SECTIONS


def ocr_settings():
    bundle = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent)) / 'ocr'
    executable = os.environ.get('VEDOMOST_TESSERACT') or (str(bundle / 'tesseract.exe') if (bundle / 'tesseract.exe').exists() else shutil.which('tesseract'))
    data = os.environ.get('VEDOMOST_TESSDATA') or (str(bundle / 'tessdata') if (bundle / 'tessdata').exists() else '')
    if not executable:
        raise ValueError('Не найден Tesseract OCR. Установите его с русским языком или используйте сборку с папкой ocr.')
    args = [executable]
    if data:
        args += ['--tessdata-dir', data]
    check = subprocess.run(args + ['--list-langs'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
    if check.returncode or not {'rus', 'eng'} <= set(check.stdout.split()):
        raise ValueError('Для распознавания нужны языки Tesseract rus и eng. Укажите VEDOMOST_TESSDATA.')
    return args


def page_words(page):
    width, height = page.rect.width, page.rect.height
    native = page.get_text('words')
    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), colorspace=fitz.csGRAY)
    pixels = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()
    # Derive designation/name/count columns from long vertical table rules.
    dark = pixels < 150
    candidates = np.where(dark[int(.08*pix.height):int(.72*pix.height)].mean(axis=0) > .64)[0]
    runs = np.split(candidates, np.where(np.diff(candidates) > 3)[0] + 1)
    lines = [float(np.mean(r))/pix.width for r in runs if len(r)]
    def boundary(low, high, default):
        found = [x for x in lines if low < x < high]
        return min(found, key=lambda x: abs(x-default)) if found else default
    bounds = [boundary(.16,.24,.20), boundary(.46,.57,.52), boundary(.77,.84,.81), boundary(.84,.90,.86)]
    if len(native) > 20:
        return [(x0/width,y0/height,x1/width,y1/height,text) for x0,y0,x1,y1,text,*_ in native], bounds, False
    args = ocr_settings()
    # Remove long table rules so OCR can read small quantities next to borders.
    # Detect long local runs too: scans often have slightly tilted table rules.
    for transpose, minimum in [(False, int(pix.width*.10)), (True, int(pix.height*.045))]:
        source = dark.T if transpose else dark
        target = pixels.T if transpose else pixels
        for index,line in enumerate(source):
            edges=np.diff(np.r_[False,line,False].astype(np.int8))
            for start,end in zip(np.where(edges==1)[0],np.where(edges==-1)[0]):
                if end-start>=minimum:
                    target[max(0,index-2):index+3,max(0,start-2):end+2]=255
    words = []
    with tempfile.TemporaryDirectory(prefix='vedomost-ocr-') as folder:
        image_path = Path(folder) / 'page.png'
        limits=[bounds[0]-.05]+bounds+[.95]
        for left,right in zip(limits,limits[1:]):
            xoff=int(left*pix.width)+5
            yoff=int(.10*pix.height)
            crop=pixels[yoff:int(.765*pix.height),xoff:int(right*pix.width)-5]
            Image.fromarray(crop).save(image_path)
            run = subprocess.run(args + [str(image_path), 'stdout', '-l', 'rus+eng', '--psm', '6', '-c', 'tessedit_create_tsv=1'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
            if run.returncode:
                raise ValueError('Ошибка OCR: ' + run.stderr[-1500:])
            if not run.stdout.startswith('level\t'):
                raise ValueError('OCR не вернул таблицу координат текста. Проверьте установку Tesseract.')
            for r in csv.DictReader(io.StringIO(run.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
                if r.get('text', '').strip() and float(r['conf']) >= 0:
                    x,y,w,h = (int(r[k]) for k in ('left','top','width','height'))
                    x+=xoff
                    y+=yoff
                    words.append((x/pix.width,y/pix.height,(x+w)/pix.width,(y+h)/pix.height,r['text']))
    return words, bounds, True


def read_pdf(path, progress=lambda text: None):
    result = Assembly(Path(path).stem, Path(path).stem, str(Path(path).resolve()))
    result.warnings.append('Проверьте обозначение сборки: первоначально оно взято из имени PDF. Для связи сборок оно должно совпадать с обозначением позиции.')
    current_section = 'Детали'
    with fitz.open(path) as document:
        if document.needs_pass:
            raise ValueError('PDF защищён паролем. Сохраните доступную копию.')
        for page_index, page in enumerate(document):
            progress(f'{Path(path).name}: страница {page_index+1}/{len(document)}')
            words, bounds, used_ocr = page_words(page)
            if used_ocr:
                result.warnings.append(f'Страница {page_index+1}: распознана OCR, проверьте все обозначения и количества.')
            rows = []
            for w in sorted(words, key=lambda w: ((w[1]+w[3])/2,w[0])):
                cy = (w[1]+w[3])/2
                if not .095 < cy < .765 or w[0] < bounds[0]-.055:
                    continue
                if not rows or abs(cy-rows[-1][0]) > .007:
                    rows.append([cy, []])
                rows[-1][1].append(w)
            active = None
            page_items = []
            for cy, row in rows:
                cells = ['']*5
                for x0,y0,x1,y1,text in sorted(row,key=lambda w:w[0]):
                    if not re.search(r'\w',text) and text not in ('*','★'):
                        continue
                    cx=(x0+x1)/2
                    col = sum(cx >= b for b in bounds)
                    cells[col] = (cells[col]+' '+text).strip()
                pos, code, name, quantity, note = cells
                if used_ocr and code and not re.search(r'\d[.\-]\d|ГОСТ|ОСТ|ТУ',code):
                    code=''
                section = next((s for s in SECTIONS if s.casefold() in name.casefold()), None)
                if section:
                    current_section, active = section, None
                    continue
                if name in ('Наименование','Кол.') or not (code or name):
                    continue
                anchor = re.fullmatch(r'\d{1,4}', pos.strip())
                docrow = current_section == 'Документация' and bool(code) and bool(name)
                amountrow = name and re.fullmatch(r'\d+(?:[.,]\d+)?',quantity.strip())
                if anchor or docrow or amountrow:
                    unit = note if note in ('м','кг','г','мм','л','м2','м²','м3','м³') else 'шт.'
                    active = Item(current_section, code, name, quantity if not docrow else '0', unit, note='' if unit==note else note, page=page_index+1, position=pos)
                    page_items.append(active)
                elif active:
                    if name and re.search(r'[\w]',name):
                        active.name += ' '+name
                    if code:
                        active.code += ' '+code
                    if note:
                        active.note = (active.note+' '+note).strip()
            result.items.extend(page_items)
            if not page_items:
                result.warnings.append(f'Страница {page_index+1}: позиции не выделены; добавьте их вручную по PDF.')
    for item in result.items:
        if item.section in ('Стандартные изделия','Материалы') and not item.code:
            standard=re.search(r'\s+((?:ГОСТ|ОСТ\S*|ТУ)\s*\d[\w .\-/]*)$',item.name)
            if standard:
                item.code=standard.group(1).strip()
                item.name=item.name[:standard.start()].strip()
    return result
