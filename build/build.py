#!/usr/bin/env python3
"""Inline art + audio + engine into a single self-contained galaxian.html."""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

subprocess.check_call([sys.executable, os.path.join(HERE, 'gen_art.py')])


def read(*parts):
    with open(os.path.join(ROOT, *parts)) as fh:
        return fh.read()


out = (read('src', 'index.template.html')
       .replace('/*__ART__*/', read('src', 'art.js'))
       .replace('/*__AUDIO__*/', read('src', 'audio.js'))
       .replace('/*__NEOAUDIO__*/', read('src', 'neoaudio.js'))
       .replace('/*__NEO__*/', read('src', 'neo.js'))
       .replace('/*__VECTOR__*/', read('src', 'vector.js'))
       .replace('/*__X__*/', read('src', 'x.js'))
       .replace('/*__ENGINE__*/', read('src', 'engine.js')))

path = os.path.join(ROOT, 'galaxian.html')
with open(path, 'w') as fh:
    fh.write(out)
print('wrote', path, os.path.getsize(path), 'bytes')
