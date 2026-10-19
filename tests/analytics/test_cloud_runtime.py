"""Synthetic data only. These tests intentionally simulate independent cold requests."""
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from analytics_runtime.snapshots import pack, restore, SnapshotError


class SnapshotTests(unittest.TestCase):
    def test_roundtrip_preserves_content_and_nanosecond_time(self):
        import os
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            root=Path(first); (root/'imports').mkdir(); file=root/'imports'/'state.json'
            file.write_text('{"revision":1}', encoding='utf8')
            os.utime(file, ns=(1700000000123456700,1700000000123456700))
            restore(pack(root), Path(second))
            self.assertEqual((Path(second)/'imports'/'state.json').read_bytes(),file.read_bytes())
            self.assertEqual((Path(second)/'imports'/'state.json').stat().st_mtime_ns,file.stat().st_mtime_ns)

    def test_path_traversal_and_missing_metadata_fail_closed(self):
        for filename in ('../outside','/absolute','C:/outside','imports/../../outside','imports\\outside'):
            out=io.BytesIO()
            with zipfile.ZipFile(out,'w') as archive: archive.writestr(filename,b'unsafe')
            with tempfile.TemporaryDirectory() as target:
                with self.assertRaises(SnapshotError): restore(out.getvalue(),Path(target))

    def test_modified_content_is_rejected(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
            (Path(source)/'state.json').write_text('original')
            original=zipfile.ZipFile(io.BytesIO(pack(Path(source))))
            out=io.BytesIO()
            with zipfile.ZipFile(out,'w') as changed:
                for name in original.namelist(): changed.writestr(name,b'changed' if name=='state.json' else original.read(name))
            with self.assertRaises(SnapshotError): restore(out.getvalue(),Path(target))

    def test_symlink_is_not_packaged(self):
        # Windows often does not permit symlink creation; the archive format still rejects Unix links.
        out=io.BytesIO(); info=zipfile.ZipInfo('link'); info.create_system=3; info.external_attr=(0o120777 << 16)
        with zipfile.ZipFile(out,'w') as archive: archive.writestr(info,'outside')
        with tempfile.TemporaryDirectory() as target:
            with self.assertRaises(SnapshotError): restore(out.getvalue(),Path(target))


if __name__=='__main__': unittest.main()
