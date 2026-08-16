"use client";

/* ============================================================
   Rate one saved design.

   Only appears for a design the signed-in user owns and has saved —
   feedback hangs off the history row, so there is nothing to attach
   a rating to until it is saved.

   The form collects judgements only. Author, culture and intensity
   are read server-side from the design record, so nothing here can
   claim a design was Moroccan or belonged to someone else. Every
   rule enforced below is enforced again in the backend; this half
   exists to make the mistake visible before a round trip, not to be
   the thing that prevents it.
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MessageSquare } from "lucide-react";
import {
  ApiError,
  fetchFeedback,
  submitFeedback,
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_MIN,
  type Feedback,
  type FurniturePlacementVerdict,
} from "@/lib/api";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  /** The saved design being rated (a history entry id). */
  historyId: number;
  /** Collapsed until opened — used in the history list, where space is tight. */
  defaultOpen?: boolean;
  onSaved?: (feedback: Feedback) => void;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

const PLACEMENTS: { value: FurniturePlacementVerdict; en: string; ar: string }[] = [
  { value: "valid", en: "Sensible", ar: "منطقي" },
  { value: "invalid", en: "Wrong", ar: "غير صحيح" },
  { value: "not_applicable", en: "No furniture added", ar: "لم يُضف أثاث" },
];

/* One 1-5 row.

   Declared at module scope rather than inside FeedbackForm. A component defined
   in a render body is a brand new type on every render, so React unmounted and
   remounted the whole fieldset each time a value changed — which threw keyboard
   focus off the button that had just been pressed.

   The buttons are a five-column grid, not a fixed-width flex row. `w-9` in a
   flex row still shrinks (flex-shrink defaults to 1), so once this form was laid
   out three-across inside the results header the boxes compressed narrower than
   their own digits and the numbers ran into each other. Grid columns divide
   whatever width exists, so they can get tight but can never overlap.

   The direction is left to `dir` on the section: in RTL the grid already places
   1 on the right, so no flex-row-reverse is needed to mirror it. */
function RatingRow({
  label,
  value,
  onChange,
  disabled,
  name,
  t,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
  name: string;
  t: (en: string, ar: string) => string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm text-[var(--dd-text-secondary)]">
        {label}
      </legend>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5">
        {RATINGS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t(
              `${n} out of ${FEEDBACK_RATING_MAX}`,
              `${n} من ${FEEDBACK_RATING_MAX}`,
            )}
            onClick={() => onChange(n)}
            disabled={disabled}
            data-name={name}
            className={cn(
              "flex h-9 min-w-0 items-center justify-center rounded-md border text-sm tabular-nums transition",
              value === n
                ? "border-[var(--dd-gold)] bg-[var(--dd-gold)] font-medium text-[var(--dd-ink)]"
                : "border-[var(--dd-gold-dim)]/40 text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)]",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {/* Which end is which. A bare 1-5 row leaves the reader to guess whether
          1 is best, and a rating given under the wrong assumption is worse than
          no rating — these numbers are the evaluation dashboard's corpus. */}
      <div className="mt-1.5 flex justify-between text-[0.65rem] uppercase tracking-wider text-[var(--dd-text-secondary)]">
        <span>{t("Poor", "ضعيف")}</span>
        <span>{t("Excellent", "ممتاز")}</span>
      </div>
    </fieldset>
  );
}

export default function FeedbackForm({ historyId, defaultOpen = false, onSaved }: Props) {
  const { isArabic } = useThemeLanguage();
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);

  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Feedback | null>(null);

  const [culturalAccuracy, setCulturalAccuracy] = useState(0);
  const [imageQuality, setImageQuality] = useState(0);
  const [roomPreservation, setRoomPreservation] = useState(0);
  const [placement, setPlacement] = useState<FurniturePlacementVerdict | "">("");
  const [comment, setComment] = useState("");

  /* Load any rating already given, so reopening a design shows what was said
     rather than an empty form that implies none exists. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFeedback(historyId)
      .then((fb) => {
        if (cancelled || !fb) return;
        setExisting(fb);
        setCulturalAccuracy(fb.culturalAccuracy);
        setImageQuality(fb.imageQuality);
        setRoomPreservation(fb.roomPreservation);
        setPlacement(fb.furniturePlacement);
        setComment(fb.comment ?? "");
      })
      .catch(() => {
        /* A design with no rating yet is the normal case, not an error. */
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [historyId]);

  const complete =
    culturalAccuracy >= FEEDBACK_RATING_MIN &&
    imageQuality >= FEEDBACK_RATING_MIN &&
    roomPreservation >= FEEDBACK_RATING_MIN &&
    placement !== "";

  const submit = async () => {
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const fb = await submitFeedback(historyId, {
        culturalAccuracy,
        imageQuality,
        roomPreservation,
        furniturePlacement: placement as FurniturePlacementVerdict,
        comment,
      });
      setExisting(fb);
      setSaved(true);
      onSaved?.(fb);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? isArabic
            ? e.message_ar
            : e.message_en
          : t("Could not save your feedback.", "تعذّر حفظ تقييمك."),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 text-sm text-[var(--dd-text-secondary)] transition hover:text-[var(--dd-gold)]",
          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
        )}
      >
        <MessageSquare size={15} />
        {existing
          ? t("Edit your rating", "تعديل تقييمك")
          : t("Rate this design", "قيّم هذا التصميم")}
      </button>
    );
  }

  return (
    <section
      dir={isArabic ? "rtl" : "ltr"}
      className="mt-4 space-y-4 rounded-2xl border border-[var(--dd-gold-dim)]/30 bg-[var(--dd-surface)] p-4"
    >
      <header className={cn(isArabic ? "text-right" : "text-left")}>
        <h4
          className={cn(
            "text-base font-semibold text-[var(--dd-gold)]",
            isArabic ? "font-arabic" : "font-display",
          )}
        >
          {existing
            ? t("Your rating", "تقييمك")
            : t("Rate this design", "قيّم هذا التصميم")}
        </h4>
        <p className="mt-1 text-xs text-[var(--dd-text-secondary)]">
          {t(
            "Your answers help measure how well the cultural styles work.",
            "تساعد إجاباتك في قياس مدى نجاح الأنماط الثقافية.",
          )}
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-[var(--dd-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("Loading…", "جارٍ التحميل…")}
        </div>
      ) : (
        <>
          {/* Columns that respond to the CONTAINER, not the viewport. This form
              renders inside a narrow flex item in the studio results header
              while the window itself is wide, so a `sm:grid-cols-3` breakpoint
              read the window, forced three columns into a few hundred pixels
              and squeezed the rating rows until their digits collided. auto-fit
              measures the space that actually exists and drops to fewer columns
              when there isn't room for three. */}
          <div
            className="grid gap-x-5 gap-y-5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}
          >
            <RatingRow
              name="culturalAccuracy"
              label={t("Cultural accuracy", "الدقة الثقافية")}
              value={culturalAccuracy}
              onChange={setCulturalAccuracy}
              disabled={saving}
              t={t}
            />
            <RatingRow
              name="imageQuality"
              label={t("Image quality", "جودة الصورة")}
              value={imageQuality}
              onChange={setImageQuality}
              disabled={saving}
              t={t}
            />
            <RatingRow
              name="roomPreservation"
              label={t("Room preserved", "الحفاظ على الغرفة")}
              value={roomPreservation}
              onChange={setRoomPreservation}
              disabled={saving}
              t={t}
            />
          </div>

          <fieldset className={cn("space-y-1.5", isArabic && "text-right")}>
            <legend className="text-sm text-[var(--dd-text-secondary)]">
              {t("Furniture placement", "توزيع الأثاث")}
            </legend>
            <div className={cn("flex flex-wrap gap-2", isArabic && "flex-row-reverse")}>
              {PLACEMENTS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={placement === p.value}
                  onClick={() => setPlacement(p.value)}
                  disabled={saving}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition",
                    placement === p.value
                      ? "border-[var(--dd-gold)] bg-[var(--dd-gold)] font-medium text-[var(--dd-ink)]"
                      : "border-[var(--dd-gold-dim)]/40 text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)]",
                  )}
                >
                  {t(p.en, p.ar)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className={cn("space-y-1.5", isArabic && "text-right")}>
            <label
              htmlFor={`feedback-comment-${historyId}`}
              className="block text-sm text-[var(--dd-text-secondary)]"
            >
              {t("Comment (optional)", "تعليق (اختياري)")}
            </label>
            <textarea
              id={`feedback-comment-${historyId}`}
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, FEEDBACK_COMMENT_MAX))}
              maxLength={FEEDBACK_COMMENT_MAX}
              rows={3}
              disabled={saving}
              placeholder={t("What worked, what didn't?", "ما الذي نجح وما الذي لم ينجح؟")}
              className="w-full rounded-lg border border-[var(--dd-gold-dim)]/40 bg-transparent px-3 py-2 text-sm text-[var(--dd-text)] placeholder:text-[var(--dd-text-secondary)]/60"
            />
            <p className="text-xs text-[var(--dd-text-secondary)]">
              {comment.trim().length}/{FEEDBACK_COMMENT_MAX}
            </p>
          </div>

          {error && (
            <p className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
              {error}
            </p>
          )}
          {saved && !error && (
            <p
              className="flex items-center gap-2 text-sm text-[var(--success)]"
              role="status"
            >
              <Check size={15} />
              {existing?.updated
                ? t("Rating updated. Thank you.", "تم تحديث التقييم. شكراً لك.")
                : t("Thank you for your feedback.", "شكراً على تقييمك.")}
            </p>
          )}

          <div className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
            <button
              onClick={submit}
              disabled={!complete || saving}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--dd-gold)] px-4 py-1.5 text-sm font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {saving
                ? t("Saving…", "جارٍ الحفظ…")
                : existing
                  ? t("Update rating", "تحديث التقييم")
                  : t("Submit rating", "إرسال التقييم")}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={saving}
              className="rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition hover:border-[var(--dd-gold)] disabled:opacity-50"
            >
              {t("Close", "إغلاق")}
            </button>
            {!complete && (
              <span className="text-xs text-[var(--dd-text-secondary)]">
                {t("All three ratings and a placement answer are required.",
                   "التقييمات الثلاثة وإجابة توزيع الأثاث مطلوبة.")}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
