/* ============================================================
   Cinema copy — bilingual EN/AR strings for the cinematic
   landing + flow scenes. Ported verbatim from the dar-design-2
   handoff bundle (js/i18n.js).

   Language/theme STATE lives in ThemeLanguageContext (the single
   source of truth that sets <html lang/dir/data-theme>). This
   module only carries the strings, keyed by language, with the
   same shape the prototype used — so scene ports read copy almost
   exactly as the original did.
   ============================================================ */

import type { Language } from "@/context/ThemeLanguageContext";
import type { StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";

export type TitleWords = string[];

export interface HousePanelCopy {
  id: StyleId;
  num: string;
  chip: string;
  chipMeaning: string;
  title: TitleWords;
  italicIdx: number;
  lede: string;
  tags: string[];
  palette: string[];
}

export interface CinemaCopy {
  chrome: {
    mark: string;
    markEn: string;
    langToggle: string;
    themeDark: string;
    themeLight: string;
    audioOn: string;
    audioOff: string;
    enterStudio: string;
  };
  boot: { calligraphy: string; english: string; caption: string };
  hero: {
    eyebrow: [string, string];
    titleWords: TitleWords;
    titleItalic: number;
    sub: string;
    primary: string;
    secondary: string;
    cue: string;
  };
  manifesto: {
    pre: string;
    quote: TitleWords;
    italicIdx: number;
    attribution: string;
  };
  houses: { eyebrow: string; panels: HousePanelCopy[] };
  atlas: {
    eyebrow: string;
    title: TitleWords;
    italicIdx: number;
    lede: string;
    cells: { en: string; ar: string }[];
  };
  transform: {
    actLabel: string;
    eyebrow: string;
    title: TitleWords;
    italicIdx: number;
    sub: string;
    dropPrompt: string;
    dropClick: string;
    formats: string;
    pickLabel: string;
    filenamePrefix: string;
    remove: string;
    cta: string;
    ctaWaitingImage: string;
    ctaWaitingStyle: string;
    ctaReady: string;
    styles: Record<StyleId, { name: string; desc: string }>;
  };
  loading: { pretitle: string; messages: string[]; meta: string };
  result: {
    eyebrow: string;
    title: TitleWords;
    italicIdx: number;
    before: string;
    after: string;
    download: string;
    share: string;
    again: string;
    tryAnother: string;
  };
  error: {
    code: string;
    title: TitleWords;
    italicIdx: number;
    message: string;
    cta: string;
    home: string;
  };
  nf: {
    code: string;
    title: TitleWords;
    italicIdx: number;
    message: string;
    cta: string;
  };
  coda: { title: TitleWords; italicIdx: number; sub: string; cta: string };
  colophon: {
    about: string;
    builtTitle: string;
    built: string[];
    placesTitle: string;
    places: string[];
    rights: string;
    version: string;
  };
}

export const CINEMA_COPY: Record<Language, CinemaCopy> = {
  en: {
    chrome: {
      mark: "Dar",
      markEn: "Design",
      langToggle: "العربية",
      themeDark: "Night",
      themeLight: "Day",
      audioOn: "Sound",
      audioOff: "Sound",
      enterStudio: "Enter the studio",
    },
    boot: { calligraphy: "ادخل", english: "Enter", caption: "The studio is opening" },
    hero: {
      eyebrow: ["DarDesign", "Atelier of Arabic Interiors"],
      titleWords: ["Every", "room", "remembers", "a", "place", "it", "has", "never", "been."],
      titleItalic: 4,
      sub: "Lebanese mountain houses. Khaleeji majlis. Moroccan riads. Upload a photograph — receive a redesign that knows where it came from.",
      primary: "Begin",
      secondary: "See the work",
      cue: "Scroll",
    },
    manifesto: {
      pre: "A note from the studio",
      quote: ["We do not", "decorate.", "We translate", "a place", "into the", "language", "it forgot."],
      italicIdx: 5,
      attribution: "DarDesign Atelier · Beirut · Riyadh · Marrakech",
    },
    houses: {
      eyebrow: "Act II — The Three Houses",
      panels: [
        {
          id: "lebanese",
          num: "01",
          chip: "بَيْت",
          chipMeaning: "Bayt — home",
          title: ["The", "Lebanese", "House"],
          italicIdx: 1,
          lede: "Limestone shoulders. Triple arches. Cedar warmth in the floorboards. Light enters slow and sits on the stone.",
          tags: ["Limestone", "Cedar", "Triple arch", "Mediterranean light"],
          palette: ["#c9a876", "#4a3520", "#2f5a4a", "#e8c1a8", "#f6efe2"],
        },
        {
          id: "khaleeji",
          num: "02",
          chip: "مَجْلِس",
          chipMeaning: "Majlis — gathering",
          title: ["The", "Khaleeji", "Majlis"],
          italicIdx: 1,
          lede: "Brass and ivory. Low cushions. Geometry repeating until it disappears. A room that listens before it speaks.",
          tags: ["Brass", "Mashrabiya", "Geometry", "Ivory"],
          palette: ["#0b5f4a", "#6e1f2c", "#d4af37", "#ede4d2", "#0d1429"],
        },
        {
          id: "moroccan",
          num: "03",
          chip: "رِياض",
          chipMeaning: "Riad — courtyard",
          title: ["The", "Moroccan", "Riad"],
          italicIdx: 1,
          lede: "Zellige hand-cut to fit. Carved plaster the color of cream. Cobalt where you least expect it. A courtyard that holds the noon.",
          tags: ["Zellige", "Tadelakt", "Cobalt", "Saffron"],
          palette: ["#1f4287", "#d4a24a", "#c44a36", "#1a6e5c", "#ede4d2"],
        },
      ],
    },
    atlas: {
      eyebrow: "Act III — The Atlas",
      title: ["A", "vocabulary", "of", "rooms."],
      italicIdx: 1,
      lede: "Every redesign is built from a vocabulary of motifs — read from photographs, drawings, and the buildings still standing.",
      cells: [
        { en: "Mashrabiya", ar: "مشربية" },
        { en: "Zellige", ar: "زليج" },
        { en: "Qanater", ar: "قناطر" },
        { en: "Muqarnas", ar: "مقرنصات" },
        { en: "Tadelakt", ar: "تادلكت" },
        { en: "Cedar", ar: "أرز" },
        { en: "Brass", ar: "نحاس" },
        { en: "Limestone", ar: "حجر جيري" },
        { en: "Hammam", ar: "حمّام" },
        { en: "Majlis", ar: "مجلس" },
        { en: "Riad", ar: "رياض" },
        { en: "Mihrab", ar: "محراب" },
      ],
    },
    transform: {
      actLabel: "Act IV — The Transformation",
      eyebrow: "The transformation",
      title: ["Show us the", "room.", "We will show you", "the room", "it could be."],
      italicIdx: 3,
      sub: "Upload one photograph. Choose a house. Hold still.",
      dropPrompt: "Lay your photograph here",
      dropClick: "Or choose a file from your device",
      formats: "JPG · PNG · up to 10 MB",
      pickLabel: "Choose the house",
      filenamePrefix: "ROOM",
      remove: "Remove",
      cta: "Begin the transformation",
      ctaWaitingImage: "Upload a room photograph first",
      ctaWaitingStyle: "Choose a house",
      ctaReady: "Begin the transformation",
      styles: {
        lebanese: { name: "Lebanese", desc: "Limestone · cedar · triple arches" },
        khaleeji: { name: "Khaleeji", desc: "Majlis · brass · mashrabiya" },
        moroccan: { name: "Moroccan", desc: "Zellige · cobalt · tadelakt" },
      },
    },
    loading: {
      pretitle: "Hold still",
      messages: [
        "Reading depth, light, and architecture",
        "Drawing from the atlas of rooms",
        "Calling the mason. Calling the carpenter.",
        "Gold dust settling",
        "Finishing the plaster",
      ],
      meta: "SDXL · dual ControlNet · cultural LoRA",
    },
    result: {
      eyebrow: "The reveal",
      title: ["A room", "remembered."],
      italicIdx: 1,
      before: "Before",
      after: "After",
      download: "Download",
      share: "Share",
      again: "Another room",
      tryAnother: "Try another house",
    },
    error: {
      code: "ERROR · 500",
      title: ["The mason set down his tools."],
      italicIdx: 0,
      message: "Something interrupted the work. The connection to the studio failed, or the photograph was too large.",
      cta: "Try again",
      home: "Return to the studio",
    },
    nf: {
      code: "404 · The door is closed",
      title: ["This room", "does not exist."],
      italicIdx: 1,
      message: "You followed a corridor that leads nowhere. The studio has many rooms — let us take you back to the first one.",
      cta: "Return to the studio",
    },
    coda: { title: ["A door", "is", "open."], italicIdx: 0, sub: "Walk through it.", cta: "Begin" },
    colophon: {
      about: "DarDesign is an interior design studio that exists inside a model. It reads photographs of rooms and rewrites them in the architectural language of three Arabic worlds — Lebanese, Khaleeji, Moroccan.",
      builtTitle: "Built with",
      built: ["SDXL", "Dual ControlNet", "Cultural LoRA", "Three.js", "WebGL"],
      placesTitle: "Cities",
      places: ["Beirut", "Riyadh", "Marrakech", "Cairo", "Doha", "Fez"],
      rights: "© 2026 DarDesign · A studio inside a model",
      version: "v3.0 · cinematic",
    },
  },

  ar: {
    chrome: {
      mark: "دار",
      markEn: "ديزاين",
      langToggle: "English",
      themeDark: "ليل",
      themeLight: "نهار",
      audioOn: "الصوت",
      audioOff: "الصوت",
      enterStudio: "ادخل المرسم",
    },
    boot: { calligraphy: "ادخل", english: "Enter", caption: "المرسم يفتح" },
    hero: {
      eyebrow: ["دار ديزاين", "مرسم العمارة العربية الداخلية"],
      titleWords: ["كل", "غرفة", "تتذكر", "مكانًا", "لم", "تكنه", "قط."],
      titleItalic: 3,
      sub: "بيت لبنان الجبلي. مجلس الخليج. رياض المغرب. ارفع صورة — تستعيد غرفتك ذاكرتها.",
      primary: "ابدأ",
      secondary: "شاهد الأعمال",
      cue: "اسحب",
    },
    manifesto: {
      pre: "كلمة من المرسم",
      quote: ["نحن لا", "نُزخرف.", "بل نترجم", "المكان", "إلى", "اللغة", "التي نسيها."],
      italicIdx: 5,
      attribution: "دار ديزاين · بيروت · الرياض · مراكش",
    },
    houses: {
      eyebrow: "الفصل الثاني — البيوت الثلاثة",
      panels: [
        {
          id: "lebanese",
          num: "٠١",
          chip: "بَيْت",
          chipMeaning: "Bayt — منزل",
          title: ["البيت", "اللبناني"],
          italicIdx: 1,
          lede: "أكتاف من الحجر الجيري. أقواس ثلاثية. دفء خشب الأرز في الأرضية. الضوء يدخل ببطء ويستقر على الحجر.",
          tags: ["حجر جيري", "أرز", "أقواس ثلاثية", "ضوء متوسطي"],
          palette: ["#c9a876", "#4a3520", "#2f5a4a", "#e8c1a8", "#f6efe2"],
        },
        {
          id: "khaleeji",
          num: "٠٢",
          chip: "مَجْلِس",
          chipMeaning: "Majlis — اجتماع",
          title: ["مجلس", "الخليج"],
          italicIdx: 0,
          lede: "نحاس وعاج. وسائد منخفضة. هندسة تتكرر حتى تختفي. غرفة تنصت قبل أن تتكلم.",
          tags: ["نحاس", "مشربية", "هندسة", "عاج"],
          palette: ["#0b5f4a", "#6e1f2c", "#d4af37", "#ede4d2", "#0d1429"],
        },
        {
          id: "moroccan",
          num: "٠٣",
          chip: "رِياض",
          chipMeaning: "Riad — فناء",
          title: ["رياض", "المغرب"],
          italicIdx: 0,
          lede: "زليج مقطوع باليد. جص منقوش بلون القشدة. أزرق كوبالت حيث لا تتوقعه. فناء يحتضن الظهيرة.",
          tags: ["زليج", "تادلكت", "كوبالت", "زعفران"],
          palette: ["#1f4287", "#d4a24a", "#c44a36", "#1a6e5c", "#ede4d2"],
        },
      ],
    },
    atlas: {
      eyebrow: "الفصل الثالث — الأطلس",
      title: ["مفردات", "الغرف."],
      italicIdx: 0,
      lede: "كل تصميم جديد مبني من مفردات — تُقرأ من الصور، والرسوم، ومن المباني التي ما زالت قائمة.",
      cells: [
        { en: "Mashrabiya", ar: "مشربية" },
        { en: "Zellige", ar: "زليج" },
        { en: "Qanater", ar: "قناطر" },
        { en: "Muqarnas", ar: "مقرنصات" },
        { en: "Tadelakt", ar: "تادلكت" },
        { en: "Cedar", ar: "أرز" },
        { en: "Brass", ar: "نحاس" },
        { en: "Limestone", ar: "حجر جيري" },
        { en: "Hammam", ar: "حمّام" },
        { en: "Majlis", ar: "مجلس" },
        { en: "Riad", ar: "رياض" },
        { en: "Mihrab", ar: "محراب" },
      ],
    },
    transform: {
      actLabel: "الفصل الرابع — التحول",
      eyebrow: "التحول",
      title: ["أرنا", "الغرفة،", "نُريك", "الغرفةَ", "كما يمكن أن تكون."],
      italicIdx: 3,
      sub: "ارفع صورة واحدة. اختر بيتًا. اثبت.",
      dropPrompt: "ضع صورتك هنا",
      dropClick: "أو اختر ملفًا من جهازك",
      formats: "JPG · PNG · حتى 10 ميغابايت",
      pickLabel: "اختر البيت",
      filenamePrefix: "غرفة",
      remove: "إزالة",
      cta: "ابدأ التحويل",
      ctaWaitingImage: "ارفع صورة الغرفة أولًا",
      ctaWaitingStyle: "اختر بيتًا",
      ctaReady: "ابدأ التحويل",
      styles: {
        lebanese: { name: "لبناني", desc: "حجر جيري · أرز · أقواس ثلاثية" },
        khaleeji: { name: "خليجي", desc: "مجلس · نحاس · مشربية" },
        moroccan: { name: "مغربي", desc: "زليج · كوبالت · تادلكت" },
      },
    },
    loading: {
      pretitle: "اثبت",
      messages: [
        "قراءة العمق والضوء والمعمار",
        "نستلهم من أطلس الغرف",
        "ينادي البنّاء. ينادي النجّار.",
        "غبار الذهب يستقر",
        "اللمسات الأخيرة على الجص",
      ],
      meta: "SDXL · ControlNet ثنائي · LoRA ثقافي",
    },
    result: {
      eyebrow: "الكشف",
      title: ["غرفة", "متذكَّرة."],
      italicIdx: 0,
      before: "قبل",
      after: "بعد",
      download: "حفظ",
      share: "مشاركة",
      again: "غرفة أخرى",
      tryAnother: "جرب بيتًا آخر",
    },
    error: {
      code: "خطأ · ٥٠٠",
      title: ["وضع البنّاء أدواته."],
      italicIdx: 0,
      message: "حدث ما قطع العمل. فشل الاتصال بالمرسم، أو كانت الصورة كبيرة جدًا.",
      cta: "أعد المحاولة",
      home: "عُد إلى المرسم",
    },
    nf: {
      code: "٤٠٤ · الباب مغلق",
      title: ["هذه الغرفة", "غير موجودة."],
      italicIdx: 0,
      message: "سرت في ممر لا يؤدي إلى مكان. للمرسم غرف كثيرة — دعنا نعيدك إلى الأولى.",
      cta: "عُد إلى المرسم",
    },
    coda: { title: ["باب", "مفتوح."], italicIdx: 1, sub: "ادخل.", cta: "ابدأ" },
    colophon: {
      about: "دار ديزاين مرسم تصميم داخلي يسكن داخل نموذج. يقرأ صور الغرف ويُعيد كتابتها بلغة معمارية من ثلاثة عوالم عربية — اللبناني والخليجي والمغربي.",
      builtTitle: "بُني بـ",
      built: ["SDXL", "ControlNet ثنائي", "LoRA ثقافي", "Three.js", "WebGL"],
      placesTitle: "مدن",
      places: ["بيروت", "الرياض", "مراكش", "القاهرة", "الدوحة", "فاس"],
      rights: "© ٢٠٢٦ دار ديزاين · مرسم داخل نموذج",
      version: "الإصدار ٣٫٠ · سينمائي",
    },
  },
};

/** Current-language cinema copy. Reads language from ThemeLanguageContext. */
export function useCinemaCopy(): CinemaCopy {
  const { language } = useThemeLanguage();
  return CINEMA_COPY[language];
}
