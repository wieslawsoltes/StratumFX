"""Validate published entry points and local link targets; no third-party dependencies."""
from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse
import json
import zipfile

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in {"href", "src"}:
                self.targets.append(value)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / "dist")
args = parser.parse_args()
root = args.root.resolve()
entries = ["index.html", "app/index.html", "docs/guide.html", "examples/index.html",
           "examples/engine.html", "examples/renderer.html", "examples/controls.html"]
errors = []
checked = 0
for entry in entries:
    page = root / entry
    if not page.is_file():
        errors.append(f"Missing entry point: {entry}")
        continue
    links = Links()
    links.feed(page.read_text(encoding="utf-8"))
    for target in links.targets:
        url = urlsplit(target)
        if url.scheme or url.netloc or not url.path:
            continue
        if url.path.startswith("/"):
            errors.append(f"{entry}: root-relative path breaks project hosting: {target}")
            continue
        local = (page.parent / unquote(url.path)).resolve()
        if not local.is_relative_to(root):
            errors.append(f"{entry}: link escapes website: {target}")
            continue
        if local.is_dir():
            local /= "index.html"
        if not local.is_file():
            errors.append(f"{entry}: missing target {target}")
        checked += 1
archive = root / "downloads/stratum-fx-source.zip"
if archive.is_file():
    with zipfile.ZipFile(archive) as z:
        broken = z.testzip()
        if broken:
            errors.append(f"Corrupt source archive entry: {broken}")
        for name in z.namelist():
            parts = Path(name).parts
            if any(part in {".git", ".data", ".env", "node_modules", "backups", ".bootstrap"} for part in parts):
                errors.append(f"Private or transient path in source archive: {name}")
report = {"entryPoints": len(entries), "localLinksChecked": checked, "errors": errors}
print(json.dumps(report, indent=2))
if errors:
    raise SystemExit(1)
