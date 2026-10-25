import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from .exporter import export_docx
from .model import Assembly, Item, SECTIONS, aggregate, load_project, number, save_project
from .reader import read_pdf


class Editor(tk.Toplevel):
    def __init__(self, parent, title, fields, callback):
        super().__init__(parent)
        self.title(title)
        self.transient(parent)
        self.grab_set()
        self.values={}
        for i,(key,label,value) in enumerate(fields):
            ttk.Label(self,text=label).grid(row=i,column=0,sticky='w',padx=10,pady=5)
            var=tk.StringVar(value=str(value))
            self.values[key]=var
            widget=ttk.Combobox(self,textvariable=var,values=SECTIONS,state='readonly',width=58) if key=='section' else ttk.Entry(self,textvariable=var,width=60)
            widget.grid(row=i,column=1,padx=10,pady=5)
        def accept():
            try:
                callback({k:v.get().strip() for k,v in self.values.items()})
                self.destroy()
            except Exception as e:
                messagebox.showerror('Проверьте данные',str(e),parent=self)
        ttk.Button(self,text='Сохранить',command=accept).grid(row=len(fields),column=1,pady=12,sticky='e')


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Ведомость — PDF → Word · первая версия')
        self.geometry('1250x760')
        self.assemblies=[]
        self.events=queue.Queue()
        self.busy=False
        self.dirty=False
        self.protocol('WM_DELETE_WINDOW',self.close)
        bar=ttk.Frame(self,padding=8)
        bar.pack(fill='x')
        for label,fn in [('Добавить PDF',self.import_pdf),('Открыть проект',self.open_project),('Сохранить проект',self.save),('Выгрузить Word',self.export)]:
            ttk.Button(bar,text=label,command=fn).pack(side='left',padx=4)
        ttk.Label(self,text='1. Добавьте PDF   →   2. Сверьте позиции и обозначения сборок   →   3. Подтвердите проверку   →   4. Выгрузите Word',padding=8).pack(anchor='w')
        pane=ttk.Panedwindow(self,orient='horizontal')
        pane.pack(fill='both',expand=True,padx=8)
        left=ttk.Frame(pane)
        right=ttk.Frame(pane)
        pane.add(left,weight=1)
        pane.add(right,weight=4)
        self.list=tk.Listbox(left,width=32,exportselection=False)
        self.list.pack(fill='both',expand=True)
        self.list.bind('<<ListboxSelect>>',lambda e:self.show_items())
        for label,fn in [('Обозначение / количество изделия',self.edit_assembly),('Открыть исходный PDF',self.open_source),('Подтвердить проверку сборки',self.review),('Удалить сборку',self.remove_assembly)]:
            ttk.Button(left,text=label,command=fn).pack(fill='x',pady=3)
        cols=('section','position','code','name','quantity','unit','page')
        self.table=ttk.Treeview(right,columns=cols,show='headings',selectmode='browse')
        for key,label,width in zip(cols,['Раздел','Поз.','Обозначение / ГОСТ','Наименование','Кол-во','Ед.','Лист'],[135,40,170,260,65,45,40]):
            self.table.heading(key,text=label)
            self.table.column(key,width=width,minwidth=35)
        self.table.pack(fill='both',expand=True)
        self.table.bind('<Double-1>',lambda e:self.edit_item())
        scroll=ttk.Scrollbar(right,orient='horizontal',command=self.table.xview)
        scroll.pack(fill='x')
        self.table.configure(xscrollcommand=scroll.set)
        buttons=ttk.Frame(right)
        buttons.pack(fill='x',pady=6)
        for label,fn in [('Добавить позицию',lambda:self.edit_item(True)),('Изменить позицию',self.edit_item),('Удалить позицию',self.remove_item)]:
            ttk.Button(buttons,text=label,command=fn).pack(side='left',padx=4)
        self.notes=tk.Text(self,height=5,wrap='word')
        self.notes.pack(fill='x',padx=8,pady=6)
        self.status=tk.StringVar(value='Все файлы обрабатываются на этом компьютере. Интернет не используется.')
        ttk.Label(self,textvariable=self.status,padding=8).pack(fill='x')
        self.after(100,self.poll)

    def selected(self):
        sel=self.list.curselection()
        return self.assemblies[sel[0]] if sel else None

    def refresh(self):
        old=self.list.curselection()
        self.list.delete(0,'end')
        for a in self.assemblies:
            self.list.insert('end',('✓ ' if a.reviewed else '⚠ ')+a.code)
        if self.assemblies:
            self.list.selection_set(min(old[0] if old else 0,len(self.assemblies)-1))
        self.show_items()

    def show_items(self):
        self.table.delete(*self.table.get_children())
        self.notes.delete('1.0','end')
        a=self.selected()
        if a:
            for i,item in enumerate(a.items):
                self.table.insert('', 'end', iid=str(i),values=[getattr(item,k) for k in self.table['columns']])
            self.notes.insert('end','\n'.join(a.warnings) or 'Сверьте позиции с исходным PDF перед подтверждением.')

    def import_pdf(self):
        if self.busy:
            return
        paths=filedialog.askopenfilenames(filetypes=[('Спецификации PDF','*.pdf')])
        if not paths:
            return
        self.busy=True
        def work():
            for path in paths:
                try:
                    result=read_pdf(path,lambda text:self.events.put(('status',text)))
                    self.events.put(('assembly',result))
                except Exception as e:
                    self.events.put(('error',f'{Path(path).name}: {e}'))
            self.events.put(('done',None))
        threading.Thread(target=work,daemon=True).start()

    def poll(self):
        try:
            while True:
                kind,value=self.events.get_nowait()
                if kind=='status':
                    self.status.set(value)
                elif kind=='assembly':
                    self.assemblies.append(value)
                    self.dirty=True
                    self.refresh()
                elif kind=='error':
                    messagebox.showerror('Не удалось прочитать PDF',value)
                elif kind=='done':
                    self.busy=False
                    self.status.set('Импорт завершён. Сверьте обозначения сборок, наименования, количества и единицы с PDF.')
        except queue.Empty:
            pass
        self.after(100,self.poll)

    def changed(self,a):
        a.reviewed=False
        self.dirty=True
        self.refresh()

    def edit_assembly(self):
        a=self.selected()
        if not a:
            return
        def apply(data):
            if not data['code']:
                raise ValueError('Введите обозначение сборки из основной надписи PDF.')
            if not number(data['root_quantity']):
                raise ValueError('Количество должно быть больше нуля.')
            for k,v in data.items():
                setattr(a,k,v)
            self.changed(a)
        Editor(self,'Сборка (количество применяется только к головному изделию)', [('code','Обозначение сборки',a.code),('name','Наименование',a.name),('root_quantity','Количество головных изделий',a.root_quantity)],apply)

    def edit_item(self,new=False):
        a=self.selected()
        sel=self.table.selection()
        if not a or (not new and not sel):
            return
        item=Item() if new else a.items[int(sel[0])]
        fields=[('section','Раздел'),('position','Позиция'),('code','Обозначение / ГОСТ / ТУ'),('name','Наименование'),('quantity','Количество (для документации: 0)'),('unit','Единица измерения'),('supplier','Поставщик'),('note','Примечание'),('page','Страница источника')]
        def apply(data):
            number(data['quantity'])
            if not data['name']:
                raise ValueError('Введите наименование.')
            data['page']=int(data['page'])
            for k,v in data.items():
                setattr(item,k,v)
            if new:
                a.items.append(item)
            self.changed(a)
        Editor(self,'Позиция спецификации',[(k,label,getattr(item,k)) for k,label in fields],apply)

    def remove_item(self):
        a=self.selected()
        sel=self.table.selection()
        if a and sel and messagebox.askyesno('Удалить позицию','Удалить выбранную позицию из проекта?'):
            a.items.pop(int(sel[0]))
            self.changed(a)

    def remove_assembly(self):
        a=self.selected()
        if a and messagebox.askyesno('Удалить сборку','Удалить сборку из проекта? Исходный PDF сохранится.'):
            self.assemblies.remove(a)
            self.dirty=True
            self.refresh()

    def review(self):
        a=self.selected()
        if not a:
            return
        try:
            if not a.items:
                raise ValueError('В сборке нет позиций.')
            for item in a.items:
                number(item.quantity)
            if messagebox.askyesno('Проверка распознавания','Вы сверили все страницы PDF, обозначение сборки, позиции, количества и единицы измерения?'):
                a.reviewed=True
                self.dirty=True
                self.refresh()
        except ValueError as e:
            messagebox.showerror('Проверьте количества',str(e))

    def open_source(self):
        a=self.selected()
        if not a:
            return
        if not Path(a.source).is_file():
            messagebox.showerror('Исходный PDF','Файл не найден по сохранённому пути. Откройте исходный PDF вручную.')
            return
        if sys.platform=='win32':
            os.startfile(a.source)
        else:
            subprocess.Popen(['open' if sys.platform=='darwin' else 'xdg-open',a.source])

    def save(self):
        path=filedialog.asksaveasfilename(defaultextension='.json',filetypes=[('Проект ведомости','*.json')])
        if path:
            try:
                save_project(path,self.assemblies)
                self.dirty=False
                return True
            except Exception as e:
                messagebox.showerror('Не удалось сохранить',str(e))
        return False

    def open_project(self):
        if self.busy:
            messagebox.showinfo('Импорт','Дождитесь окончания импорта PDF.')
            return
        if not self.can_discard():
            return
        path=filedialog.askopenfilename(filetypes=[('Проект ведомости','*.json')])
        if path:
            try:
                loaded=load_project(path)
                self.assemblies=loaded
                self.dirty=False
                self.refresh()
            except Exception as e:
                messagebox.showerror('Не удалось открыть',str(e))

    def export(self):
        if self.busy:
            messagebox.showinfo('Импорт','Дождитесь окончания импорта PDF.')
            return
        if any(not a.reviewed for a in self.assemblies):
            messagebox.showinfo('Проверка','Сначала подтвердите проверку каждой спецификации.')
            return
        try:
            groups,warnings=aggregate(self.assemblies)
            if warnings and not messagebox.askyesno('Есть нераскрытые сборки','\n'.join(warnings)+'\n\nВыгрузить неполную ведомость с перечнем нераскрытых сборок?'):
                return
            title=simpledialog.askstring('Основная надпись','Наименование изделия:',initialvalue='Изделие')
            if title is None:
                return
            designation=simpledialog.askstring('Основная надпись','Обозначение ведомости:',initialvalue='Ведомость ТВК')
            if designation is None:
                return
            path=filedialog.asksaveasfilename(defaultextension='.docx',filetypes=[('Документ Word','*.docx')])
            if path:
                export_docx(path,groups,title,designation,warnings)
                self.status.set('Word сохранён. Проверьте разбиение страниц перед печатью.')
                messagebox.showinfo('Готово','Ведомость сохранена. Это первая версия оформления по образцу; перед выпуском проверьте документ в Word.')
        except Exception as e:
            messagebox.showerror('Выгрузка невозможна',str(e))

    def can_discard(self):
        if not self.dirty:
            return True
        choice=messagebox.askyesnocancel('Изменения проекта','Сохранить изменения проекта?')
        return self.save() if choice else choice is False

    def close(self):
        if self.busy and not messagebox.askyesno('Импорт','Импорт ещё выполняется. Закрыть программу?'):
            return
        if self.can_discard():
            self.destroy()


def main():
    App().mainloop()
