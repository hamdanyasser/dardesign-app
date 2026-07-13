// ALL user-facing strings for "The Understood Room" — the Arabic copy is FINAL
// (UNDERSTOOD_ROOM_THREEJS_SPEC.md §5, verbatim). One file so Zainab can review
// every string in one place. Do not inline copy anywhere else.

export const COPY = {
  s1: {
    eyebrowAr: "دار ديزاين",
    eyebrowEn: "DARDESIGN",
    h1: "الغرفة المفهومة",
    sub: "THE UNDERSTOOD ROOM",
    line1: "صورة واحدة لغرفتك — وثلاثة أجوبة:",
    line2: "كيف تبدو، كيف تُرتَّب، وكيف تُسكَن.",
    lineEn:
      "One photograph. Three answers: how it looks, how it sits, how it feels to live in",
    hintAr: "اعبر العتبة",
    hintEn: "CROSS THE THRESHOLD",
  },

  s2: {
    eyebrow: "٠٢ · THREE HOUSES",
    h2: "البيوت الثلاثة",
    sub: "بيت لبناني، مجلس خليجي، رياض مغربي — كل تقليدٍ بهندسته الحيّة",
    portals: [
      {
        ar: "البيت اللبناني",
        en: "LEBANESE BAYT",
        detail: "قوس ثلاثي · حجر جبل لبنان",
      },
      {
        ar: "المجلس الخليجي",
        en: "KHALEEJI MAJLIS",
        detail: "جصّ محفور · أقواس نجدية",
      },
      {
        ar: "الرياض المغربي",
        en: "MOROCCAN RIAD",
        detail: "زليج يتوالد · قوس حذوة الفرس",
      },
    ],
  },

  s3: {
    eyebrow: "٠٣ · THE UNDERSTANDING",
    h2: "هكذا تُفهَم الغرفة",
    sub: "الصورة تنشقّ عن طبقاتها — النمط، المخطّط، العمق",
    layers: [
      { ar: "٠١ · كيف تبدو", tag: "النمط — HOW IT LOOKS" },
      { ar: "٠٢ · كيف تُرتَّب", tag: "المخطّط — HOW IT SITS" },
      { ar: "٠٣ · كيف تُسكَن", tag: "العمق — HOW IT FEELS" },
    ],
  },

  s4: {
    eyebrow: "٠٤ · THE TRANSFORMATION",
    h2: "شاهد التقليد يظهر",
    sub: "اسحب — فيتكثّف التقليد من الفضاء الكامن",
    scrubberTitle: "شدّة الثقافة · CULTURE INTENSITY",
    stops: [
      "ضوء محايد",
      "حجر جيري لبناني",
      "قوس ثلاثي",
      "كليم وديوان",
      "نحاس وقنديل",
      "لوحة خطّ عربي",
    ],
    end0: "٠٪ غرفة صامتة",
    end100: "١٠٠٪ بيت لبناني",
  },

  s5: {
    eyebrow: "٠٥ · THE INVITATION",
    doorAr: "ادخل",
    doorEn: "الاستوديو · ENTER THE STUDIO",
    closing1: "دار ديزاين — البيت الذي يفهم نفسه",
    closing2: "لبناني · خليجي · مغربي",
    dropAr: "ألقِ صورة غرفتك هنا",
    dropEn: "DROP YOUR ROOM TO CROSS",
    dropHint: "اسحب صورة · أو انقر للاختيار",
    dropError: "الرجاء اختيار صورة (JPG/PNG) أقل من ١٠ ميغابايت",
  },

  rail: ["العتبة", "البيوت الثلاثة", "الفهم", "التحوّل", "الدعوة"],

  mode: {
    toDay: "نهار · DAY",
    toNight: "ليل · NIGHT",
    ariaToggle: "تبديل الوضع ليل نهار",
  },

  sound: {
    ariaToggle: "تشغيل الصوت المحيط · toggle ambient sound",
  },
} as const;

export type Copy = typeof COPY;
