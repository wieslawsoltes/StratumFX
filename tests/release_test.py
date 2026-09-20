"""Regression tests for release archives; standard-library dependencies only."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('stratum_release', Path(__file__).resolve().parents[1] / 'scripts/release.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.root.mkdir()
        self.output = Path(self.temp.name) / 'delivery.zip'

    def write(self, name, content=b'payload'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_epoch_timestamp_is_clamped_without_changing_source(self):
        path = self.write('app/main.js', b'export const ready = true;\n')
        os.utime(path, (0, 0))
        release.archive(self.output, self.root, 'stratum-fx')
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.getinfo('stratum-fx/app/main.js').date_time, (1980, 1, 1, 0, 0, 0))
            self.assertEqual(z.read('stratum-fx/app/main.js'), path.read_bytes())
            self.assertIsNone(z.testzip())
        self.assertEqual(path.stat().st_mtime, 0)

    def test_future_timestamp_is_clamped(self):
        path = self.write('future.txt')
        os.utime(path, (4354819200, 4354819200))  # 2108-01-01 UTC.
        release.archive(self.output, self.root)
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.getinfo('future.txt').date_time, (2107, 12, 31, 23, 59, 58))
            self.assertEqual(z.read('future.txt'), b'payload')

    def test_private_and_transient_files_are_excluded(self):
        for name in ['.git/config', '.data/project.json', '.bootstrap/source.xz', '.env',
                     'backups/private.json', 'node_modules/dependency.js', 'cache/__pycache__/x.pyc',
                     'db.sqlite', 'db.sqlite-shm', 'db.sqlite-wal', '.DS_Store']:
            self.write(name)
        self.write('.env.example', b'PORT=4173\n')
        self.write('app/main.js')
        for allow_zips in (False, True):
            with self.subTest(allow_zips=allow_zips):
                release.archive(self.output, self.root, allow_zips=allow_zips)
                with zipfile.ZipFile(self.output) as z:
                    self.assertEqual(z.namelist(), ['.env.example', 'app/main.js'])

    def test_source_archive_omits_nested_zip_files(self):
        self.write('README.md')
        self.write('dist/downloads/old-source.zip')
        release.archive(self.output, self.root, 'stratum-fx')
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.namelist(), ['stratum-fx/README.md'])

    def test_site_archive_includes_download_but_never_itself(self):
        self.write('index.html')
        self.write('downloads/source.zip', b'existing download')
        output = self.root / 'website.zip'
        release.archive(output, self.root, allow_zips=True)
        with zipfile.ZipFile(output) as z:
            self.assertEqual(z.namelist(), ['downloads/source.zip', 'index.html'])
            self.assertEqual(z.read('downloads/source.zip'), b'existing download')

    def test_symlinks_are_not_archived(self):
        target = Path(self.temp.name) / 'private.txt'
        target.write_text('not part of source')
        (self.root / 'link.txt').symlink_to(target)
        self.write('public.txt')
        release.archive(self.output, self.root)
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.namelist(), ['public.txt'])

    def test_unicode_paths_and_binary_contents_roundtrip(self):
        payload = bytes(range(256))
        self.write('examples/zażółć.dat', payload)
        release.archive(self.output, self.root, 'stratum-fx')
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.read('stratum-fx/examples/zażółć.dat'), payload)
            self.assertIsNone(z.testzip())


if __name__ == '__main__':
    unittest.main()
