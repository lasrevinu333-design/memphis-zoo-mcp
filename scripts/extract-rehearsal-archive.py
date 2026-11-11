#!/usr/bin/env python3
"""Use the existing bounded tar admission before any rehearsal authentication."""
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode = True

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Expected owned archive and nonexistent destination')
    spec = importlib.util.spec_from_file_location('safe_readback', Path(__file__).with_name('verify-encrypted-backup-readback.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.safe_extract(sys.argv[1], sys.argv[2])
