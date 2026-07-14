# Survey deployment kit — استبيان دراسة المستخدم

Everything needed to get the user study **in the field tonight**. Source
instrument: [user-study-survey.md](user-study-survey.md). Target: **18 evaluators**
(٦ مصممين · ٦ طلاب عمارة · ٦ من عامة سكان المنطقة), hard floor N=15.

---

## 1 · Google Form build spec (hand to a browser agent or build by hand, ~20 min)

**Create ONE master form, then duplicate it twice and reorder the style
sections** → 3 links (A: L→K→M, B: K→M→L, C: M→L→K). Distribute round-robin —
this is the per-participant order randomisation the instrument requires
(Google Forms can't shuffle sections natively).

**Form settings:** do NOT collect email addresses (anonymity promise) · show
progress bar · confirmation message: «شكرًا جزيلًا! إجاباتك تدعم بحثًا جامعيًا
عن التصميم العربي.»

**Title:** استبيان دار ديزاين · DarDesign User Study
**Description:** paste the مقدمة + privacy block from user-study-survey.md verbatim.

**Section 1 — معلومات عامة · Background** (3 questions, all required)
1. خلفيتك المهنية · Your background — multiple choice: مصمم/ة داخلي أو معماري · طالب/ة عمارة أو تصميم · مهتم/ة عام بالتصميم
2. مدى إلمامك بالعمارة العربية التقليدية · Familiarity — multiple choice: منخفض · متوسط · عالٍ
3. المنطقة · Region — short answer

**Sections 2–4 — one per style (لبناني / خليجي / مغربي)**, each contains:
- Two images at the top: **original room** then **redesign** (from `outputs/finals/`)
- The 10 Likert statements from user-study-survey.md as **linear scale 1–5**,
  bilingual label per statement, scale anchors: ١ = أعارض بشدة · ٥ = أوافق بشدة
- All required.

**Section 5 — أسئلة مفتوحة · Open-ended** (3 paragraph questions, optional) —
copy the three from the instrument.

**Analysis mapping (keep for the results notebook):** authenticity Q1–2 ·
aesthetic Q3–4 · structure Q5–6 · cultural accuracy Q7–8 · willingness Q9–10.
Per-construct mean + Cronbach's α across the item pair.

---

## 2 · WhatsApp recruit message (send tonight, round-robin the 3 links)

> السلام عليكم! 👋
> أنا وزينب نشتغل على مشروع تخرّجنا: **دار ديزاين** — ذكاء اصطناعي يعيد تصميم
> غرفتك بطراز عربي أصيل (لبناني، خليجي، مغربي) 🏠✨
> نحتاج رأيك كـ[مصمم/ة | طالب/ة عمارة | شخص عنده ذوق 😄] — استبيان قصير
> **٥–٧ دقائق فقط**، مجهول تمامًا، تقيّم فيه صور قبل/بعد.
> 🔗 [FORM_LINK]
> ردّك قبل **[DEADLINE]** يساعدنا كثير. وإذا تقدر ترسله لشخص مهتم، نكون ممنونين! 🙏

**EN fallback:** Hi! Zainab and I are finishing our graduation project —
DarDesign, an AI that redesigns rooms in authentic Arab styles. We need your
eye: a 5–7 min anonymous survey rating before/after images. Link: [FORM_LINK]
— answers before [DEADLINE] help a lot!

## 3 · Chase templates

**Chase 1 (Day 3):** «مرحبًا 🌟 تذكير صغير باستبيان دار ديزاين — ٥ دقائق بس،
ويقفل [DATE]. رأيك فعلًا يفرق معنا: [FORM_LINK]»
**Chase 2 (Day 5, final):** «آخر يوم للاستبيان اليوم 🙏 إذا ما عندك وقت، حتى
إجابة سريعة تساعد. شكرًا من القلب! [FORM_LINK]»

## 4 · Evaluator tracker (copy into a sheet)

| # | الاسم | الفئة (مصمم/طالب/عام) | Link (A/B/C) | أُرسل | ردّ | Chase 1 | Chase 2 |
|---|------|------------------------|--------------|-------|-----|---------|---------|
| 1 | | | | | | | |

Timeline: send **tonight** → chase Fri Jul 17 → chase Sun Jul 19 → **lock Mon
Jul 20**, charts same day → deck v2 Tue Jul 21. If N < 15, report N honestly;
the metrics suite is the primary evaluation.
