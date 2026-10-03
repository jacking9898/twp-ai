"""Convert user-supplied YAML/CSV data for local review; never execute scripts.
Usage: python scripts/import-public-presets.py <directory containing prompts-main and terms-main>
"""
import csv
import hashlib
import io
import json
import pathlib
import sys
import yaml

root = pathlib.Path(sys.argv[1])
experts = []
for path in sorted((root / 'prompts-main/plugins').glob('*.yml')):
    data = yaml.safe_load(path.read_text(encoding='utf-8'))
    prompt = data.get('aiBatch', {}).get('taskSystemPrompt')
    if not prompt:
        raise ValueError(f'Missing semantic batch prompt: {path}')
    experts.append(dict(id='public-' + data['id'], name=data.get('i18n', {}).get('zh-CN', {}).get('name', data['name']),
                        prompt=prompt, author=data.get('author', ''), version=data.get('version', ''),
                        source=f'https://github.com/immersive-translate/prompts/blob/main/plugins/{path.name}', builtin=True))
glossaries = []
for name in json.loads((root / 'terms-main/meta/index.json').read_text(encoding='utf-8')):
    path = root / f'terms-main/meta/{name}.json'
    data = json.loads(path.read_text(encoding='utf-8-sig'))
    translations = {}
    for lang in data['langs']:
        suffix = '' if lang == 'auto' else '_' + lang
        file = root / f'terms-main/glossaries/{data.get("glossary", name)}{suffix}.csv'
        if not file.exists():
            raise ValueError(f'Missing glossary: {file}')
        entries = {}
        for row in csv.DictReader(io.StringIO(file.read_text(encoding='utf-8-sig'))):
            source = (row.get('source') or '').strip()
            if source:
                entries[source] = (row.get('target') or '').strip() or source
        translations[lang] = list(map(list, entries.items()))
    glossaries.append(dict(id='public-' + name, name=data.get('i18ns', {}).get('zh-CN', {}).get('name', data['name']),
                           translations=translations, entries=translations.get('zh-CN', translations.get('auto', [])),
                           author=data.get('author', ''), builtin=True,
                           source=f'https://github.com/immersive-translate/terms/blob/main/meta/{name}.json'))
result = dict(experts=experts, glossaries=glossaries)
destination = pathlib.Path(__file__).resolve().parents[1] / '.local-data/presets.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for expert in experts:
    name = expert['id']
    if not all(c.isalnum() or c in '-_' for c in name):
        raise ValueError('Unsupported preset id')
    (destination.parent / (name + '.prompt.txt')).write_text(expert['prompt'], encoding='utf-8')
for glossary in glossaries:
    name = glossary['id']
    if not all(c.isalnum() or c in '-_' for c in name):
        raise ValueError('Unsupported glossary id')
    for lang, entries in glossary['translations'].items():
        if not all(c.isalnum() or c in '-_' for c in lang):
            raise ValueError('Unsupported language code')
        (destination.parent / (name + '.' + lang + '.terms.txt')).write_text('\n'.join(f'{a} = {b}' for a, b in entries), encoding='utf-8')
print(f'{len(experts)} experts; {len(glossaries)} glossaries converted for local review.')
for repo in ['prompts', 'terms']:
    archive = root / f'{repo}.zip'
    if archive.exists():
        print(repo, 'archive sha256', hashlib.sha256(archive.read_bytes()).hexdigest())
print('Local files are ignored by Git and are not bundled. Confirm rights before sharing.')
