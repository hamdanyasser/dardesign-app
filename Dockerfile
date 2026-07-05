# DarDesign backend — LIGHT image (placeholder mode) by default.
#
#   docker build -t dardesign-backend .
#   docker run -p 8000:8000 dardesign-backend
#
# The full UI flow is exercisable against this image (placeholder PNGs,
# synthetic depth/seg). Real SDXL generation needs a CUDA host: install
# backend/requirements.txt there instead, mount models/loras/, and run
# with DARDESIGN_LIGHT unset (see kaggle/README.md for the free-T4 path).

FROM python:3.10-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DARDESIGN_LIGHT=1

COPY backend/requirements-light.txt backend/requirements-light.txt
RUN pip install --no-cache-dir -r backend/requirements-light.txt

COPY backend/ backend/
COPY ontology/ ontology/
COPY configs/ configs/

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
