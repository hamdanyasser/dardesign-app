# DarDesign — top-level task runner.
# Targets are POSIX-friendly; on Windows run via `make` from a shell that has it
# (Git Bash, WSL, or `mingw32-make`). Otherwise, copy the command bodies.

PY ?= python
PIP ?= pip
NODE ?= node
NPM ?= npm

BACKEND_HOST ?= 0.0.0.0
BACKEND_PORT ?= 8000

CULTURE ?= lebanese
DATA_DIR ?= datasets/$(CULTURE)
RANK ?= 16
STEPS ?= 1500
LORA_OUT ?= models/loras/$(CULTURE)

.PHONY: help setup setup-backend setup-frontend backend backend-light frontend \
        test test-backend smoke-prompt smoke-train sweep finals ablate metrics \
        baseline-grid clean clean-outputs

help:
	@echo "DarDesign make targets:"
	@echo "  setup            install backend + frontend deps"
	@echo "  backend          run FastAPI (real pipeline; needs GPU/Kaggle)"
	@echo "  backend-light    run FastAPI in DARDESIGN_LIGHT mode (no GPU; placeholder outputs)"
	@echo "  frontend         run Next.js dev server"
	@echo "  test             run pytest"
	@echo "  smoke-prompt     prompt-builder smoke test (no GPU)"
	@echo "  smoke-train      train_lora.py with placeholder captions on the 5 test rooms (Kaggle T4)"
	@echo "  train-lora       full LoRA training run (CULTURE=, DATA_DIR=, RANK=, STEPS=)"
	@echo "  sweep            ControlNet weight sweep -> outputs/sweeps/"
	@echo "  finals           45-image final batch -> outputs/finals/"
	@echo "  ablate           --no-lora / --no-segmentation / --no-ontology -> outputs/ablations/"
	@echo "  baseline-grid    build the input grid + baseline folders for Decor8/RoomGPT screenshots"
	@echo "  metrics          SSIM + LPIPS over outputs/finals -> eval/results.csv"
	@echo "  clean            remove caches"
	@echo "  clean-outputs    remove generated outputs (keeps models/ and datasets/)"

setup: setup-backend setup-frontend

setup-backend:
	$(PIP) install -r backend/requirements.txt

setup-frontend:
	$(NPM) install

backend:
	cd backend && uvicorn main:app --host $(BACKEND_HOST) --port $(BACKEND_PORT) --reload

backend-light:
	cd backend && DARDESIGN_LIGHT=1 uvicorn main:app --host $(BACKEND_HOST) --port $(BACKEND_PORT) --reload

frontend:
	$(NPM) run dev

test: test-backend

test-backend:
	$(PY) -m pytest tests/ -q

smoke-prompt:
	$(PY) -m backend.prompt_builder --culture lebanese --room "living room"
	$(PY) -m backend.prompt_builder --culture khaleeji --room "majlis"
	$(PY) -m backend.prompt_builder --culture moroccan --room "riad courtyard"

smoke-train:
	$(PY) scripts/train_lora.py \
		--culture $(CULTURE) \
		--data-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
		--rank $(RANK) \
		--steps 200 \
		--output-dir $(LORA_OUT)/_smoke \
		--smoke

train-lora:
	$(PY) scripts/train_lora.py \
		--culture $(CULTURE) \
		--data-dir $(DATA_DIR) \
		--rank $(RANK) \
		--steps $(STEPS) \
		--output-dir $(LORA_OUT)

sweep:
	$(PY) scripts/controlnet_sweep.py --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms --out outputs/sweeps

finals:
	$(PY) scripts/generate_finals.py --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms --out outputs/finals

ablate:
	$(PY) scripts/ablate.py --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms --out outputs/ablations

baseline-grid:
	$(PY) scripts/baseline_grid.py --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms --out outputs/baselines

metrics:
	$(PY) scripts/metrics.py --finals outputs/finals --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms --out eval/results.csv

clean:
	rm -rf .pytest_cache .ruff_cache .mypy_cache backend/__pycache__ scripts/__pycache__ tests/__pycache__

clean-outputs:
	rm -rf outputs/finals/* outputs/sweeps/* outputs/ablations/* outputs/baselines/decor8/* outputs/baselines/roomgpt/* outputs/baselines/ours/*
