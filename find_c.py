import re, pathlib, sys
text = pathlib.Path('app.js').read_text(encoding='utf-8')
for line in text.splitlines():
    if re.search(r"key\s*===\s*['\"]c['\"]", line, re.I):
        sys.stdout.write(line + '\n')
