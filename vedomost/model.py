from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
import json
import re
from pathlib import Path

SECTIONS = ['Сборочные единицы', 'Детали', 'Документация', 'Стандартные изделия', 'Материалы', 'Прочие изделия']


def norm(value):
    return re.sub(r'\s+', ' ', value.strip()).casefold().replace('ё', 'е')


def number(value):
    try:
        result = Decimal(str(value).strip().replace(',', '.'))
    except InvalidOperation:
        raise ValueError(f'Неверное количество: {value!r}') from None
    if not result.is_finite() or result < 0:
        raise ValueError(f'Количество должно быть конечным и неотрицательным: {value}')
    return result


def fmt(value):
    return format(value, 'f').replace('.', ',')


@dataclass
class Item:
    section: str = 'Детали'
    code: str = ''
    name: str = ''
    quantity: str = '1'
    unit: str = 'шт.'
    supplier: str = ''
    note: str = ''
    page: int = 1
    position: str = ''

    def key(self):
        # Never collapse dimensions, standards or Latin/Cyrillic lookalikes.
        if self.section in ('Детали', 'Сборочные единицы') and self.code.strip():
            return (norm(self.section), norm(self.code), norm(self.unit))
        return (norm(self.section), norm(self.code), norm(self.name), norm(self.unit))


@dataclass
class Assembly:
    code: str
    name: str
    source: str = ''
    items: list[Item] = field(default_factory=list)
    reviewed: bool = False
    root_quantity: str = '1'
    warnings: list[str] = field(default_factory=list)


@dataclass
class Group:
    item: Item
    usages: dict[str, Decimal] = field(default_factory=dict)

    @property
    def total(self):
        return sum(self.usages.values(), Decimal(0))


def aggregate(assemblies, roots=None):
    if not assemblies:
        raise ValueError('Добавьте спецификации.')
    lookup = {}
    for a in assemblies:
        if not a.code.strip():
            raise ValueError('У каждой сборки должно быть обозначение.')
        if norm(a.code) in lookup:
            raise ValueError(f'Две спецификации с одним обозначением: {a.code}')
        lookup[norm(a.code)] = a
        for item in a.items:
            if item.section not in SECTIONS or not item.name.strip():
                raise ValueError(f'{a.code}: проверьте раздел и наименование позиции {item.position}.')
            q = number(item.quantity)
            if item.section != 'Документация' and q == 0:
                raise ValueError(f'{a.code}: нулевое количество позиции {item.position}.')
    # Validate all components, including cycles that have no top-level root.
    visited = set()
    def validate(a, stack):
        key = norm(a.code)
        if key in stack:
            raise ValueError('Циклическая входимость: ' + ' → '.join(stack + [key]))
        if key in visited:
            return
        for item in a.items:
            child = lookup.get(norm(item.code)) if item.section == 'Сборочные единицы' else None
            if child:
                validate(child, stack + [key])
        visited.add(key)
    for a in assemblies:
        validate(a, [])
    referenced = {norm(i.code) for a in assemblies for i in a.items if i.section == 'Сборочные единицы'}
    if roots is None:
        roots = [a.code for a in assemblies if norm(a.code) not in referenced]
    if not roots:
        raise ValueError('Не выбрано головное изделие.')
    groups, warnings = {}, []
    def walk(a, multiplier, path):
        for item in a.items:
            amount = number(item.quantity) * multiplier
            key = item.key()
            if key in groups:
                old = groups[key].item
                if (norm(old.name), norm(old.supplier), norm(old.note)) != (norm(item.name), norm(item.supplier), norm(item.note)):
                    raise ValueError(f'Различаются данные одинаковой позиции {item.code or item.name}. Уточните название, поставщика и примечание.')
            group = groups.setdefault(key, Group(item))
            usage = ' → '.join(path)
            group.usages[usage] = group.usages.get(usage, Decimal(0)) + amount
            if item.section == 'Сборочные единицы':
                child = lookup.get(norm(item.code))
                if child:
                    walk(child, amount, path + [child.code])
                else:
                    warnings.append(f'Не раскрыта сборка {item.code or item.name} (входит в {usage})')
    for code in roots:
        if norm(code) not in lookup:
            raise ValueError(f'Не найдена головная сборка {code}')
        a = lookup[norm(code)]
        count = number(a.root_quantity)
        if not count:
            raise ValueError(f'{a.code}: количество головных изделий должно быть больше нуля.')
        walk(a, count, [a.code])
    return sorted(groups.values(), key=lambda g: (SECTIONS.index(g.item.section), norm(g.item.name), norm(g.item.code))), list(dict.fromkeys(warnings))


def save_project(path, assemblies):
    Path(path).write_text(json.dumps({'version': 1, 'assemblies': [asdict(a) for a in assemblies]}, ensure_ascii=False, indent=2), encoding='utf-8')


def load_project(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    if data.get('version') != 1:
        raise ValueError('Неизвестная версия проекта.')
    result = []
    for raw in data['assemblies']:
        raw['items'] = [Item(**item) for item in raw['items']]
        result.append(Assembly(**raw))
    return result
