"""Prepare the user's Word form without rebuilding its drawing objects."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
from lxml import etree

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS={'w':W}
source=Path(sys.argv[1])
target=Path(__file__).resolve().parents[1]/'web/public/template.docx'
target.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(source) as z:
    files={name:z.read(name) for name in z.namelist()}
doc=etree.fromstring(files['word/document.xml'])
table=doc.find('.//w:body/w:tbl',NS)
row=deepcopy(table.findall('w:tr',NS)[4])
for r in table.findall('w:tr',NS):table.remove(r)
for i,c in enumerate(row.findall('w:tc',NS)):
    p=c.find('w:p',NS)
    run=p.find('w:r',NS)
    rpr=deepcopy(run.find('w:rPr',NS)) if run is not None and run.find('w:rPr',NS) is not None else None
    for child in list(c):
        if child.tag!='{'+W+'}tcPr':c.remove(child)
    newp=etree.SubElement(c,'{'+W+'}p')
    ppr=p.find('w:pPr',NS)
    if ppr is not None:newp.append(deepcopy(ppr))
    newr=etree.SubElement(newp,'{'+W+'}r')
    if rpr is not None:newr.append(rpr)
    etree.SubElement(newr,'{'+W+'}t').text='{{cell'+str(i)+'}}'
table.append(row)
files['word/document.xml']=etree.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
for name in list(files):
    if name.startswith(('word/header','word/footer')) and name.endswith('.xml'):
        root=etree.fromstring(files[name])
        for t in root.findall('.//w:t',NS):
            if t.text in ('ХХХХ.111111.11ТВК','ХХХХ.111111.11'):t.text='{{designation}}'
            elif t.text=='Стенд ':t.text='{{title}}'
            elif t.text=='Версия 0':t.text='{{version}}'
            elif t.text=='08.09.2026':t.text='{{date}}'
            elif t.text=='сввсвс':t.text=''
        files[name]=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
# Remove original authoring metadata, leaving all drawing relationships intact.
if 'docProps/core.xml' in files:
    root=etree.fromstring(files['docProps/core.xml'])
    for child in root:child.text=''
    files['docProps/core.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,data in files.items():z.writestr(name,data)
print(target)
