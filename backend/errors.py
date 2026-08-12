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
ERR_HISTORY_NOT_FOUND = ApiError(
    "history_not_found", 404,
    "Design not found.",
    "التصميم غير موجود.",
)
ERR_FEEDBACK_INVALID = ApiError(
    "feedback_invalid", 400,
    "Please check the ratings and try again.",
    "يرجى مراجعة التقييمات والمحاولة مرة أخرى.",
)
ERR_FORBIDDEN = ApiError(
    "forbidden", 403,
    "You do not have access to this.",
    "ليس لديك صلاحية الوصول إلى هذا.",
)
ERR_BAD_SHARE_TOKEN = ApiError(
    "bad_share_token", 400,
    "Share link is invalid or expired.",
    "رابط المشاركة غير صالح أو منتهي الصلاحية.",
)
ERR_BAD_FURNITURE_ID = ApiError(
    "bad_furniture_id", 400,
    "Unknown furniture item.",
    "قطعة الأثاث غير معروفة.",
)
ERR_CATALOGUE_UNAVAILABLE = ApiError(
    "catalogue_unavailable", 500,
    "Furniture catalogue could not be loaded.",
    "تعذّر تحميل كتالوج الأثاث.",
)
ERR_INVALID_PLACEMENT = ApiError(
    "invalid_placement", 400,
    "The furniture cannot be placed at this position.",
    "لا يمكن وضع الأثاث في هذا الموضع.",
)
ERR_COMPOSITING_FAILED = ApiError(
    "compositing_failed", 500,
    "Could not insert the furniture into the room.",
    "تعذّر إدراج الأثاث في الغرفة.",
)

# --- colour control (wall / floor recolouring) ---
ERR_BAD_COLOR = ApiError(
    "bad_color", 400,
    "Colour must be a hex value like #C0392B.",
    "يجب أن يكون اللون بصيغة ست عشرية مثل ‎#C0392B.",
)
ERR_COLOR_AREA_NOT_FOUND = ApiError(
    "color_area_not_found", 404,
    "The selected area could not be detected in this room.",
    "تعذّر تحديد المنطقة المختارة في هذه الغرفة.",
)
ERR_RECOLOR_FAILED = ApiError(
    "recolor_failed", 500,
    "Could not change the colour of this area.",
    "تعذّر تغيير لون هذه المنطقة.",
)
ERR_NOTHING_TO_UNDO = ApiError(
    "nothing_to_undo", 400,
    "There is no colour change to undo.",
    "لا يوجد تغيير لون للتراجع عنه.",
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


# --- accounts ---
ERR_NOT_AUTHENTICATED = ApiError(
    "not_authenticated", 401,
    "Please sign in to continue.",
    "يرجى تسجيل الدخول للمتابعة.",
)
ERR_BAD_CREDENTIALS = ApiError(
    "bad_credentials", 401,
    "Incorrect email or password.",
    "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
)
ERR_EMAIL_TAKEN = ApiError(
    "email_taken", 409,
    "An account with this email already exists.",
    "يوجد حساب مسجّل بهذا البريد الإلكتروني.",
)
ERR_INVALID_EMAIL = ApiError(
    "invalid_email", 400,
    "Please enter a valid email address.",
    "يرجى إدخال بريد إلكتروني صالح.",
)
ERR_WEAK_PASSWORD = ApiError(
    "weak_password", 400,
    "Password must be at least 6 characters.",
    "يجب أن تتكون كلمة المرور من ٦ أحرف على الأقل.",
)
ERR_MISSING_NAME = ApiError(
    "missing_name", 400,
    "Please enter your full name.",
    "يرجى إدخال الاسم الكامل.",
)
ERR_BAD_IMAGE_DATA = ApiError(
    "bad_image_data", 400,
    "The image could not be read.",
    "تعذّرت قراءة الصورة.",
)

# --- plans and the weekly generation allowance ---
# 429 rather than 403: the request is permitted, it is the rate that isn't, and
# the allowance refills on its own.
ERR_QUOTA_EXCEEDED = ApiError(
    "quota_exceeded", 429,
    "You have used all 3 free designs for this week. Upgrade to Pro for unlimited designs.",
    "لقد استخدمت التصاميم الثلاثة المجانية لهذا الأسبوع. اشترك في الخطة الاحترافية للحصول على تصاميم غير محدودة.",
)
ERR_SUBSCRIPTION_PENDING = ApiError(
    "subscription_pending", 409,
    "Your request is already waiting for the admin's approval.",
    "طلبك قيد المراجعة من قِبل المشرف.",
)
ERR_ALREADY_SUBSCRIBED = ApiError(
    "already_subscribed", 409,
    "You are already on the Pro plan.",
    "أنت مشترك في الخطة الاحترافية بالفعل.",
)
ERR_NOT_SUBSCRIBED = ApiError(
    "not_subscribed", 400,
    "You are on the Basic plan, so there is nothing to cancel.",
    "أنت على الخطة الأساسية، لا يوجد اشتراك لإلغائه.",
)
ERR_REQUEST_NOT_PENDING = ApiError(
    "request_not_pending", 409,
    "This request no longer exists or has already been decided.",
    "هذا الطلب لم يعد موجوداً أو تمّت معالجته مسبقاً.",
)

# --- design planner ---
# There is no "planner unavailable" error on purpose: with no model configured
# the planner returns a rule-based layout rather than failing, so the only way
# to reach an error here is a request that could never describe a room.
ERR_BAD_ROOM = ApiError(
    "bad_room", 400,
    "That room's dimensions are not usable. Width and depth must be between 100 and 2000 cm.",
    "أبعاد الغرفة غير صالحة. يجب أن يكون العرض والعمق بين ١٠٠ و٢٠٠٠ سم.",
)
ERR_BAD_CULTURE = ApiError(
    "bad_culture", 400,
    "Unknown culture.",
    "طراز غير معروف.",
)
