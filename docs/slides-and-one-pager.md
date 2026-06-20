# DarDesign — Slide deck outline + one-pager (AR + EN)

Drop into Google Slides / PowerPoint with the Tajawal font, gold-on-charcoal
(`#C9A227` on `#181410`). Each slide = title (EN + AR) + the bullets to say.
Target ~14 min talk → 18 slides @ ~45 s. `[fig]` = insert a generated image /
chart.

---

## Slide deck (18 slides)

**1 · Title.** دار ديزاين · DarDesign — *culturally-grounded AI interior
redesign.* Names, supervisor, date. `[fig: hero render]`

**2 · The hook (الغرفة المفهومة / The Understood Room).** One photo → three views
of the same room: how it **looks**, how it's **laid out**, how it **feels**. *No
competitor connects culture → space.*

**3 · Problem.** AI restyle tools give generic "modern/boho." Nobody reproduces a
*named* tradition (qanater, sadu, zellige) or proves it. `[fig: generic vs ours]`

**4 · Our claim (the moat).** Three **trained** cultural models + **measured**
distinctiveness + true **spatial** understanding. *That trio is the thesis.*

**5 · Competitive table.** Decor8 / RoomGPT / Interior AI vs DarDesign (trained
models ✓, dual ControlNet ✓, confusion matrix ✓, named provenance ✓).

**6 · System overview.** The pipeline diagram: photo → depth + segmentation →
dual ControlNet + per-culture LoRA + ontology prompt → restyled image · 2D map ·
3D. `[fig: architecture]`

**7 · Structure preservation.** Depth (Depth Anything V2) + segmentation
(OneFormer) hold walls/windows/layout; the LoRA only repaints. `[fig:
input | depth | seg | output]`

**8 · Cultural ontology.** 45 bilingual terms, sourced; drives the prompt **and**
the on-screen explanation. *Functional, not decorative.* `[fig: highlighter]`

**9 · Training the three styles.** DreamBooth-LoRA (rank 16) over SDXL, 12–40
low-shot images, bilingual captions, trigger phrases.

**10 · The hard part (engineering result).** SDXL LoRA won't fit a free 16 GB T4
— fp32 OOMs, fp16 NaNs. Fix: **cache latents + embeddings, free the encoders,
train the fp32 UNet only.** Peak ≈14 GB, stable. *A transferable contribution.*

**11 · The three souls.** `[fig: same room → Lebanese | Khaleeji | Moroccan]` —
the single most persuasive slide. Name the elements in each.

**12 · Style Intensity Slider (live ablation).** Drag 0 %→100 %, watch culture
emerge from the latent space. *The ablation, interactive.*

**13 · Evaluation 1 — cultural distinctiveness.** CLIP zero-shot confusion matrix,
LoRA vs prompt-only. `[fig: matrix]` Near-diagonal ⇒ three distinct traditions.

**14 · Evaluation 2 — structure fidelity + ablations.** SSIM/LPIPS table;
`--no-lora / --no-seg / --no-ontology` grid. `[fig: table + grid]`

**15 · User study.** ≥15 Arab respondents rate authenticity per style. `[fig:
5 charts]`

**16 · Security, privacy, MLOps.** Injection guardrails; 24 h TTL auto-delete +
bilingual privacy notice; provenance manifest; one CPU-testable inference module.

**17 · The product.** Arabic-first, RTL, DarCinema landing + studio flow; live
demo (or recorded). `[fig: app]`

**18 · Contributions + future work.** ✅ 3 trained cultural LoRAs on free
hardware, dual-ControlNet structure preservation, measured authenticity, named
provenance, the 16 GB recipe. → Bigger datasets, 4th tradition, C2PA manifest,
larger study. **Thank you · شكراً.**

> Speaker notes live in `docs/defense-qa.md` (the 18 hardest questions).

---

## One-pager (EN)

**DarDesign — culturally-grounded AI interior redesign**

Upload a room photo; DarDesign re-imagines it in **Lebanese, Khaleeji, or
Moroccan** style while **preserving your room's geometry**, then shows it three
ways: the restyled image, a top-down 2D layout map, and an explorable 3D scene —
in an Arabic-first (RTL) web app.

**What's new.** Unlike generic AI-restyle tools, DarDesign uses **three
separately trained cultural models** (DreamBooth-LoRA over SDXL), preserves
structure with **dual ControlNet** (depth + segmentation), and grounds every
motif in a **45-term bilingual architectural ontology** that drives both the
generation and a "name every element, cite every source" explanation layer.
Cultural distinctiveness is **measured** (CLIP confusion matrix), not asserted.

**Engineering.** Runs end-to-end on a single free 16 GB GPU. SDXL LoRA training,
normally too large for 16 GB, is made to fit by caching image latents and text
embeddings once, freeing the encoders, and training only the fp32-master UNet
(autocast + GradScaler) — stable and ≈14 GB.

**Stack.** SDXL 1.0 · 3 DreamBooth-LoRAs · Depth Anything V2 · OneFormer · dual
ControlNet · FastAPI · Next.js 14 + Tailwind + Three.js · Kaggle T4.

**Team.** Yasser — AI/backend/frontend/3D · Zainab — dataset/ontology/Arabic
UX/user study/cultural sign-off.

---

## ورقة تعريفية (AR)

**دار ديزاين — إعادة تصميمٍ داخليٍّ بالذكاء الاصطناعي، مؤصَّلةٌ ثقافيًا**

ارفع صورة غرفتك، فيعيد «دار ديزاين» تصوّرها بطرازٍ **لبناني أو خليجي أو مغربي**
مع **الحفاظ على هندسة الغرفة**، ثم يعرضها بثلاث طبقات: الصورة المُعاد تصميمها،
وخريطة مخطّطٍ ثنائية الأبعاد من الأعلى، ومشهدٌ ثلاثيُّ الأبعادِ قابلٌ للاستكشاف —
في تطبيق ويبٍ عربيٍّ أولاً (من اليمين إلى اليسار).

**الجديد.** خلافًا للأدوات العامة، يستخدم «دار ديزاين» **ثلاثة نماذجَ ثقافيةٍ
مُدرَّبةً منفصلة** (LoRA فوق SDXL)، ويحافظ على البنية عبر **شبكتَي تحكّمٍ** (عمقٌ
وتجزئةٌ دلالية)، ويؤصّل كلَّ عنصرٍ في **أنطولوجيا معماريةٍ من ٤٥ مصطلحًا ثنائيةِ
اللغة** تقود التوليدَ والشرحَ معًا. والتمايزُ الثقافيُّ **مقيسٌ** (مصفوفة CLIP)
لا مُدّعى.

**الهندسة.** يعمل كاملاً على معالجٍ رسوميٍّ مجانيٍّ واحدٍ سعتُه ١٦ غيغابايت؛
وقد جُعِل تدريبُ LoRA — الذي يفوق هذه السعة عادةً — مُلائمًا عبر تخزين الكامنات
والتضمينات مرةً واحدةً وتحرير المُرمِّزات وتدريب شبكة UNet بدقّةٍ كاملةٍ فقط.

**الفريق.** ياسر — الذكاء الاصطناعي والواجهتان والثلاثي الأبعاد · زينب — البيانات
والأنطولوجيا وتجربة المستخدم العربية ودراسة المستخدمين والمراجعة الثقافية.
