#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="/home/user/.pyenv/versions/3.11.10/bin/python"

if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
