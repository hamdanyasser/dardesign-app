import type { Language } from "@/context/ThemeLanguageContext";
import type { GenerationStoryState } from "./types";

interface DesignChapterCopy {
  eyebrow: string;
  title: string;
  body: string;
}

interface StoryCopy {
  design: {
    title: string;
    subtitle: string;
    chapters: readonly DesignChapterCopy[];
    before: string;
    after: string;
    previewNotice: string;
    previewTransformationTitle: string;
    previewTransformationBody: string;
    editedTransformationTitle: string;
    editedTransformationBody: string;
    editedOutput: string;
    detectedElements: string;
    spatialObjects: string;
    depthEvidence: string;
    noUnderstanding: string;
    explanation: string;
    explanationEmpty: string;
    basis: string;
    measurement: string;
    evidenceRule: string;
    methodology: string;
    source: string;
    editedEvidence: string;
    unavailable: string;
    keepLabels: {
      save: string;
      history: string;
      report: string;
    };
  };
  generation: {
    eyebrow: string;
    title: string;
    subtitle: string;
    loopLabel: string;
    truthNote: string;
    chapter: string;
    of: string;
    pause: string;
    resume: string;
    previous: string;
    next: string;
    elapsed: string;
    backendProgress: string;
    noTelemetry: string;
    statusUnavailable: string;
    status: Record<GenerationStoryState, string>;
    chapters: readonly {
      title: string;
      body: string;
    }[];
    segmentationUnavailable: string;
    segmentationEvidence: string;
    depthUnavailable: string;
    depthCaption: string;
    researchUnavailable: string;
    researchSource: string;
    pipelineCaption: string;
    metaphorLabel: string;
    originalDetail: string;
    noRegionsDetected: string;
    pipeline: {
      room: string;
      roomUnderstanding: string;
      cultureSelection: string;
      ontologyPrompt: string;
      cultureLora: string;
      diffusionPipeline: string;
      generatedDesign: string;
      generatedDesignAll: string;
    };
  };
}

export const STORY_COPY: Record<Language, StoryCopy> = {
  en: {
    design: {
      title: "Design Story",
      subtitle: "One room, read carefully and transformed with evidence in view.",
      chapters: [
        {
          eyebrow: "01 — The room",
          title: "The room, before interpretation.",
          body: "The original photograph remains the visual source of truth.",
        },
        {
          eyebrow: "02 — What DAR understood",
          title: "Read the space before restyling it.",
          body: "Returned detections and spatial data are shown as evidence. Cultural meaning stays separate.",
        },
        {
          eyebrow: "03 — The cultural lens",
          title: "A vocabulary, not a costume.",
          body: "Materials, palette, and architecture come from DAR’s current project ontology.",
        },
        {
          eyebrow: "04 — The transformation",
          title: "The generated room takes the frame.",
          body: "Compare the source photograph with the actual result returned by DAR.",
        },
        {
          eyebrow: "05 — Why these choices",
          title: "Explain what the evidence supports.",
          body: "Selected culture, returned room data, and supplied provenance are kept distinct from measurements.",
        },
        {
          eyebrow: "06 — Design it yourself",
          title: "Continue from story to authorship.",
          body: "A dedicated integration point hands the room to DAR Designer without implementing it here.",
        },
        {
          eyebrow: "07 — The evidence",
          title: "Measured, or left blank.",
          body: "A missing measurement is an em dash—never a fabricated zero.",
        },
        {
          eyebrow: "08 — Keep the story",
          title: "Save the room’s next chapter.",
          body: "Save, History, and Room Report remain owned by their existing product flows.",
        },
      ],
      before: "Original",
      after: "DAR result",
      previewNotice: "Preview mode — this is a stand-in, not a GPU-generated redesign.",
      previewTransformationTitle: "A preview stand-in takes the frame.",
      previewTransformationBody: "Compare the source with the clearly labelled LIGHT-mode stand-in; it is not generation evidence.",
      editedTransformationTitle: "The edited room takes the frame.",
      editedTransformationBody: "Compare the source photograph with the current edited design. Structure metrics still describe the pristine generation.",
      editedOutput: "Edited result",
      detectedElements: "Detected elements",
      spatialObjects: "Spatial objects",
      depthEvidence: "Depth map returned",
      noUnderstanding: "No returned room-understanding data is available for this result.",
      explanation: "Explanation",
      explanationEmpty: "No supported explanation metadata was supplied.",
      basis: "Basis",
      measurement: "Measurement",
      evidenceRule: "Only values reported or computed by the project are shown.",
      methodology: "Method",
      source: "Source",
      editedEvidence: "Structure metrics describe the pristine generation, before the displayed edits.",
      unavailable: "Unavailable",
      keepLabels: { save: "Save", history: "History", report: "Room report" },
    },
    generation: {
      eyebrow: "Inside DAR",
      title: "While DAR designs your room, see how the system works.",
      subtitle: "A documentary loop built from your room and any real project assets supplied.",
      loopLabel: "Documentary loop",
      truthNote: "This story explains the system. Its chapters are not live backend stages and do not measure generation progress.",
      chapter: "Chapter",
      of: "of",
      pause: "Pause story",
      resume: "Resume story",
      previous: "Previous chapter",
      next: "Next chapter",
      elapsed: "Elapsed",
      backendProgress: "Backend-reported progress",
      noTelemetry: "No live stage telemetry is supplied.",
      statusUnavailable: "No live request status supplied",
      status: {
        requesting: "Request active",
        pending: "Uploaded",
        queued: "Queued",
        running: "Generating",
        done: "Ready",
        error: "Generation error",
      },
      chapters: [
        {
          title: "The room",
          body: "The uploaded photograph remains the reference throughout the redesign.",
        },
        {
          title: "Understanding the space",
          body: "Real segmentation imagery or returned detections can identify only the room elements the pipeline actually found.",
        },
        {
          title: "Preserving structure",
          body: "Depth and ControlNet provide spatial conditioning; this chapter explains that architecture, not a live runtime stage.",
        },
        {
          title: "Cultural research",
          body: "Prompt experiments, model studies, and LoRA research appear only when real project media is supplied.",
        },
        {
          title: "Cultural intelligence",
          body: "The supported conceptual path links room understanding, culture selection, ontology logic, and generation.",
        },
        {
          title: "Generation",
          body: "A restrained material study stands in as a visual metaphor—not as an inference screenshot or progress meter.",
        },
        {
          title: "Almost ready",
          body: "The story loops gracefully until the real generation promise resolves independently.",
        },
      ],
      segmentationUnavailable: "No segmentation image or returned region data was supplied to this waiting view.",
      segmentationEvidence: "Returned room labels",
      depthUnavailable: "No real depth image was supplied to this waiting view.",
      depthCaption: "Depth image — brighter values are closer",
      researchUnavailable: "No sourced research media is available. DAR will not invent screenshots or training evidence.",
      researchSource: "Research archive",
      pipelineCaption: "Conceptual architecture — not live telemetry",
      metaphorLabel: "Visual metaphor — not inference telemetry",
      originalDetail: "Detail from the original room",
      noRegionsDetected: "No supported room regions were detected.",
      pipeline: {
        room: "Room",
        roomUnderstanding: "Room understanding",
        cultureSelection: "Culture selection",
        ontologyPrompt: "Ontology / prompt logic",
        cultureLora: "Culture LoRA",
        diffusionPipeline: "Diffusion pipeline",
        generatedDesign: "Generated design",
        generatedDesignAll: "Three separate generated designs",
      },
    },
  },
  ar: {
    design: {
      title: "قصة التصميم",
      subtitle: "غرفة واحدة، تُقرأ بعناية وتتحوّل مع إبقاء الدليل ظاهرًا.",
      chapters: [
        {
          eyebrow: "٠١ — الغرفة",
          title: "الغرفة، قبل أيّ تأويل.",
          body: "تبقى الصورة الأصلية المرجع البصري الحقيقي.",
        },
        {
          eyebrow: "٠٢ — ما فهمته دار",
          title: "قراءة المكان قبل إعادة تصميمه.",
          body: "تظهر الاكتشافات والبيانات المكانية المُعادة كدليل، ويبقى المعنى الثقافي منفصلًا.",
        },
        {
          eyebrow: "٠٣ — العدسة الثقافية",
          title: "مفردات، لا زيًّا تنكريًا.",
          body: "تأتي الخامات والألوان والعمارة من أنطولوجيا مشروع دار الحالية.",
        },
        {
          eyebrow: "٠٤ — التحوّل",
          title: "النتيجة المولّدة تملأ المشهد.",
          body: "قارن الصورة الأصلية بالنتيجة الفعلية التي أعادتها دار.",
        },
        {
          eyebrow: "٠٥ — لماذا هذه الخيارات",
          title: "نشرح ما يدعمه الدليل فقط.",
          body: "نفصل الثقافة المختارة وبيانات الغرفة والإسناد المتاح عن القياسات.",
        },
        {
          eyebrow: "٠٦ — صمّمها بنفسك",
          title: "من القصة إلى التأليف.",
          body: "نقطة ربط مخصّصة تنقل الغرفة إلى مصمّم دار من دون تنفيذه هنا.",
        },
        {
          eyebrow: "٠٧ — الدليل",
          title: "مُقاس، أو متروك فارغًا.",
          body: "القيمة غير المقاسة تظهر كشرطة طويلة، لا كصفر مختلق.",
        },
        {
          eyebrow: "٠٨ — احتفظ بالقصة",
          title: "احفظ الفصل التالي للغرفة.",
          body: "يبقى الحفظ والسجل وتقرير الغرفة ضمن تدفّقات المنتج الحالية.",
        },
      ],
      before: "الأصل",
      after: "نتيجة دار",
      previewNotice: "وضع المعاينة — هذه صورة بديلة وليست إعادة تصميم مولّدة بوحدة GPU.",
      previewTransformationTitle: "صورة معاينة بديلة تملأ المشهد.",
      previewTransformationBody: "قارن المصدر بالصورة البديلة المعلّمة بوضوح في وضع LIGHT؛ فهي ليست دليلاً على التوليد.",
      editedTransformationTitle: "الغرفة المعدّلة تملأ المشهد.",
      editedTransformationBody: "قارن الصورة الأصلية بالتصميم المعدّل الحالي. تبقى مقاييس البنية خاصة بالنتيجة الأصلية قبل التعديل.",
      editedOutput: "نتيجة معدّلة",
      detectedElements: "العناصر المكتشفة",
      spatialObjects: "العناصر المكانية",
      depthEvidence: "خريطة العمق مُعادة",
      noUnderstanding: "لا تتوفر بيانات مُعادة لفهم الغرفة مع هذه النتيجة.",
      explanation: "التفسير",
      explanationEmpty: "لم تُقدَّم بيانات تفسير مدعومة.",
      basis: "الأساس",
      measurement: "القياس",
      evidenceRule: "تظهر فقط القيم التي أبلغ عنها المشروع أو حسبها.",
      methodology: "المنهج",
      source: "المصدر",
      editedEvidence: "تصف مقاييس البنية النتيجة الأصلية قبل التعديلات الظاهرة.",
      unavailable: "غير متاح",
      keepLabels: { save: "حفظ", history: "السجل", report: "تقرير الغرفة" },
    },
    generation: {
      eyebrow: "داخل دار",
      title: "بينما تصمّم دار غرفتك، تعرّف إلى طريقة عمل النظام.",
      subtitle: "حلقة وثائقية مبنية على غرفتك وأي أصول حقيقية يوفّرها المشروع.",
      loopLabel: "حلقة وثائقية",
      truthNote: "تشرح هذه القصة النظام. فصولها ليست مراحل مباشرة من الخادم ولا تقيس تقدّم التوليد.",
      chapter: "الفصل",
      of: "من",
      pause: "إيقاف القصة مؤقتًا",
      resume: "متابعة القصة",
      previous: "الفصل السابق",
      next: "الفصل التالي",
      elapsed: "الوقت المنقضي",
      backendProgress: "التقدّم المُبلغ عنه من الخادم",
      noTelemetry: "لم تُزوَّد بيانات مباشرة لمراحل الخادم.",
      statusUnavailable: "لم تُزوَّد حالة مباشرة للطلب",
      status: {
        requesting: "الطلب نشط",
        pending: "تم الرفع",
        queued: "في قائمة الانتظار",
        running: "جارٍ التوليد",
        done: "جاهز",
        error: "خطأ في التوليد",
      },
      chapters: [
        {
          title: "الغرفة",
          body: "تبقى الصورة المرفوعة مرجعًا طوال إعادة التصميم.",
        },
        {
          title: "فهم المكان",
          body: "لا تعرض صور التقسيم أو الاكتشافات المُعادة إلا عناصر الغرفة التي وجدها النظام فعلًا.",
        },
        {
          title: "الحفاظ على البنية",
          body: "يوفّر العمق وControlNet تكييفًا مكانيًا؛ يشرح هذا الفصل البنية التقنية ولا يدّعي أنه مرحلة حيّة.",
        },
        {
          title: "البحث الثقافي",
          body: "لا تظهر تجارب الموجّهات ودراسات النماذج وأبحاث LoRA إلا عند توفير وسائط حقيقية من المشروع.",
        },
        {
          title: "الذكاء الثقافي",
          body: "يربط المسار المفاهيمي المدعوم فهم الغرفة واختيار الثقافة ومنطق الأنطولوجيا والتوليد.",
        },
        {
          title: "التوليد",
          body: "دراسة خامات هادئة تعمل كاستعارة بصرية، لا كلقطة استدلال أو مقياس تقدّم.",
        },
        {
          title: "أوشكنا على الانتهاء",
          body: "تستمر القصة بسلاسة إلى أن ينتهي وعد التوليد الحقيقي بشكل مستقل.",
        },
      ],
      segmentationUnavailable: "لم تُزوَّد شاشة الانتظار بصورة تقسيم أو بيانات مناطق مُعادة.",
      segmentationEvidence: "تسميات الغرفة المُعادة",
      depthUnavailable: "لم تُزوَّد شاشة الانتظار بصورة عمق حقيقية.",
      depthCaption: "صورة العمق — القيم الأفتح أقرب",
      researchUnavailable: "لا تتوفر وسائط بحث موثّقة المصدر. لن تختلق دار لقطات شاشة أو أدلة تدريب.",
      researchSource: "أرشيف البحث",
      pipelineCaption: "بنية مفاهيمية — وليست قياسًا مباشرًا",
      metaphorLabel: "استعارة بصرية — وليست بيانات استدلال",
      originalDetail: "تفصيل من الغرفة الأصلية",
      noRegionsDetected: "لم يكتشف النظام مناطق غرفة مدعومة.",
      pipeline: {
        room: "الغرفة",
        roomUnderstanding: "فهم الغرفة",
        cultureSelection: "اختيار الثقافة",
        ontologyPrompt: "الأنطولوجيا / منطق الموجّه",
        cultureLora: "LoRA ثقافي",
        diffusionPipeline: "مسار توليد انتشاري",
        generatedDesign: "التصميم المولّد",
        generatedDesignAll: "ثلاثة تصاميم مولّدة منفصلة",
      },
    },
  },
};
