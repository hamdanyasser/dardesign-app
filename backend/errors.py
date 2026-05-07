"""Bilingual error catalog. Every backend HTTPException uses one of these codes
so the frontend can render the right Arabic message without hard-coding strings."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ApiError:
    code: str
    http_status: int
    message_en: str
    message_ar: str

    def payload(self, *, detail_en: str | None = None, detail_ar: str | None = None) -> dict:
        return {
            "code": self.code,
            "message_en": detail_en or self.message_en,
            "message_ar": detail_ar or self.message_ar,
        }


# 4xx — user-side
ERR_NOT_AN_IMAGE = ApiError(
    "not_an_image", 400,
    "Uploaded file is not an image.",
    "الملف الذي تم رفعه ليس صورة.",
)
ERR_FILE_TOO_LARGE = ApiError(
    "file_too_large", 413,
    "Image is larger than 10 MB.",
    "حجم الصورة أكبر من 10 ميغابايت.",
)
ERR_IMAGE_TOO_SMALL = ApiError(
    "image_too_small", 400,
    "Image must be at least 256x256 pixels.",
    "يجب أن تكون أبعاد الصورة 256x256 على الأقل.",
)
ERR_CORRUPT_IMAGE = ApiError(
    "corrupt_image", 400,
    "Image file is corrupt or unreadable.",
    "الملف تالف أو لا يمكن قراءته.",
)
ERR_JOB_NOT_FOUND = ApiError(
    "job_not_found", 404,
    "Job not found.",
    "المهمة غير موجودة.",
)
ERR_JOB_BAD_STATE = ApiError(
    "job_bad_state", 400,
    "Job is not ready for this action.",
    "المهمة ليست جاهزة لهذه العملية.",
)
ERR_BAD_STYLE = ApiError(
    "bad_style", 400,
    "Unknown style.",
    "النمط غير معروف.",
)
ERR_BAD_SHARE_TOKEN = ApiError(
    "bad_share_token", 400,
    "Share link is invalid or expired.",
    "رابط المشاركة غير صالح أو منتهي الصلاحية.",
)

# 5xx — server-side
ERR_PIPELINE = ApiError(
    "pipeline_failed", 500,
    "Generation pipeline failed.",
    "فشلت عملية التوليد.",
)
ERR_OUTPUT_MISSING = ApiError(
    "output_missing", 500,
    "Output file missing.",
    "ملف الناتج غير موجود.",
)
