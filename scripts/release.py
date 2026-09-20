"""Create source/static/library deliveries without databases, credentials or nested ZIPs.
Run after npm run build && npm run pack:all.
"""
from __future__ import annotations
import argparse, hashlib, json, pathlib, shutil, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
EXCLUDED={'.git','.data','node_modules','backups','__pycache__','.env','.DS_Store'}

def files(root: pathlib.Path):
    for path in sorted(root.rglob('*')):
        relative=path.relative_to(root)
        if not path.is_file() or path.is_symlink() or any(p in EXCLUDED for p in relative.parts): continue
        if path.suffix in {'.zip','.pyc','.sqlite','.sqlite-shm','.sqlite-wal'}: continue
        yield path,relative

def archive(destination: pathlib.Path, root: pathlib.Path, prefix: str='', allow_zips: bool=False):
    destination.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=8) as z:
        if allow_zips:
            iterator=((p,p.relative_to(root)) for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink())
        else: iterator=files(root)
        for path,relative in iterator:
            if any(p in EXCLUDED for p in relative.parts):continue
            z.write(path,str(pathlib.PurePosixPath(prefix)/pathlib.PurePosixPath(relative.as_posix())))
    with zipfile.ZipFile(destination) as z:
        failure=z.testzip()
        if failure: raise RuntimeError('Corrupt ZIP entry: '+failure)

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=pathlib.Path,default=ROOT.parent)
parser.add_argument('--site-download',action='store_true',help='Only write the full-source download into dist/downloads, for hosting workflows')
args=parser.parse_args()
for required in ['README.md','docs/TEST_REPORT.md','dist/index.html','dist/StratumFX.html','packages/core/dist/index.js']:
    if not (ROOT/required).is_file():raise SystemExit('Missing release input: '+required+'; run the build first.')
output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
source=(ROOT/'dist/downloads/stratum-fx-source.zip') if args.site_download else output/'stratum-fx-source.zip'
archive(source,ROOT,'stratum-fx')
if args.site_download:
    print(source)
else:
    (ROOT/'dist/downloads').mkdir(parents=True,exist_ok=True)
    shutil.copy2(source,ROOT/'dist/downloads/stratum-fx-source.zip')
    archive(output/'stratum-fx-site.zip',ROOT/'dist',allow_zips=True)
    archive(output/'stratum-fx-libraries.zip',ROOT/'artifacts/packages')
    for name,path in {'StratumFX.html':'dist/StratumFX.html','StratumFX-preview.png':'artifacts/studio-preview.png','StratumFX-site-preview.png':'artifacts/site-preview.png','StratumFX-test-report.md':'docs/TEST_REPORT.md'}.items():
        shutil.copy2(ROOT/path,output/name)
    manifest={}
    for name in ['stratum-fx-source.zip','stratum-fx-site.zip','stratum-fx-libraries.zip','StratumFX.html']:
        p=output/name;manifest[name]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    (output/'stratum-fx-checksums.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))
