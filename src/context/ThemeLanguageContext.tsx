"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { StyleId } from "@/context/ImageContext";

export type Language = "en" | "ar";
export type Theme = "dark" | "light";

type NavLink = {
  href: string;
  label: string;
};

type StepCopy = {
  number: string;
  icon: string;
  title: string;
  description: string;
};

type StyleCopy = {
  flag: string;
  name: string;
  selectorDescription: string;
  origin: string;
  landingDescription: string;
  tags: string[];
  learnMore: string;
};

type TranslationShape = {
  metadata: {
    title: string;
    description: string;
  };
  brand: {
    name: string;
    engine: string;
  };
  controls: {
    languageToggle: string;
    openMenu: string;
    closeMenu: string;
    switchToLight: string;
    switchToDark: string;
  };
  landing: {
    nav: {
      links: NavLink[];
    };
    hero: {
      title: string;
      subtitle: string;
      primaryCta: string;
      secondaryCta: string;
    };
    socialProof: {
      title: string;
      metrics: string[];
    };
    howItWorks: {
      eyebrow: string;
      title: string;
      steps: StepCopy[];
    };
    styles: {
      eyebrow: string;
      title: string;
    };
    preview: {
      eyebrow: string;
      title: string;
      before: string;
      after: string;
      description: string;
    };
    uploadCta: {
      title: string;
      dropzone: string;
      support: string;
      footnote: string;
    };
  };
  shared: {
    styles: Record<StyleId, StyleCopy>;
    styleSelector: {
      title: string;
      select: string;
      selected: string;
    };
    upload: {
      dragPrompt: string;
      clickPrompt: string;
      formats: string;
      invalidType: string;
      invalidSize: string;
      invalidDimensions: string;
      previewAlt: string;
      removeImage: string;
    };
    footer: {
      about: string;
      quickLinksTitle: string;
      techTitle: string;
      poweredBy: string;
      techStack: string;
      rights: string;
    };
  };
  transform: {
    title: string;
    cta: string;
    incompleteBoth: string;
    incompleteImage: string;
    incompleteStyle: string;
  };
  result: {
    title: string;
    download: string;
    newRoom: string;
    loadingFallback: string;
    beforeLabel: string;
    afterLabel: string;
  };
  loading: {
    messages: string[];
  };
};

const translations = {
  en: {
    metadata: {
      title: "DarDesign — AI interior design inspired by Arabic architecture",
      description:
        "Upload a room, choose Lebanese, Khaleeji, or Moroccan style, and see an AI-powered transformation in seconds.",
    },
    brand: {
      name: "DarDesign",
      engine: "by Turath Engine",
    },
    controls: {
      languageToggle: "عربي",
      openMenu: "Open navigation menu",
      closeMenu: "Close navigation menu",
      switchToLight: "Switch to light mode",
      switchToDark: "Switch to dark mode",
    },
    landing: {
      nav: {
        links: [
          { href: "#home", label: "Home" },
          { href: "#how-it-works", label: "How it Works" },
          { href: "#styles", label: "Styles" },
          { href: "#contact", label: "Contact" },
        ],
      },
      hero: {
        title: "Redesign Your Space with the Soul of Arabic Architecture",
        subtitle:
          "Upload any room. Choose Lebanese, Khaleeji, or Moroccan style. Watch AI transform it in seconds.",
        primaryCta: "Start Designing",
        secondaryCta: "See Examples",
      },
      socialProof: {
        title: "Trusted by 2,000+ designers across the Middle East",
        metrics: [
          "50K+ Rooms Transformed",
          "3 Cultural Styles",
          "< 30s Generation",
          "4.9★ Rating",
          "Free to Try",
        ],
      },
      howItWorks: {
        eyebrow: "How it works",
        title: "A cultural redesign flow built to feel effortless",
        steps: [
          {
            number: "01",
            icon: "📸",
            title: "Upload Your Room",
            description:
              "Share any interior photo and let the model read depth, layout, light, and architectural cues instantly.",
          },
          {
            number: "02",
            icon: "🎨",
            title: "Choose Your Style",
            description:
              "Pick a regionally rooted direction shaped by Lebanese, Khaleeji, or Moroccan design language.",
          },
          {
            number: "03",
            icon: "✨",
            title: "See the Transformation",
            description:
              "Get a polished concept in seconds, with the same room and layout reimagined through a new cultural lens.",
          },
        ],
      },
      styles: {
        eyebrow: "Premium styles",
        title: "Three distinct design lineages, one refined workflow",
      },
      preview: {
        eyebrow: "Before and after",
        title: "See the difference",
        before: "Before",
        after: "After",
        description:
          "This is what DarDesign does. Same room. Same layout. Completely new soul.",
      },
      uploadCta: {
        title: "Ready to Transform?",
        dropzone: "Drag your room photo here or click to browse",
        support: "Supports JPG, PNG up to 10MB",
        footnote: "Start for free. No credit card required.",
      },
    },
    shared: {
      styles: {
        lebanese: {
          flag: "🇱🇧",
          name: "Lebanese",
          selectorDescription: "Stone arches · Warm limestone · Cedar warmth",
          origin: "Lebanese Heritage · التراث اللبناني",
          landingDescription:
            "Warm limestone, triple-arched silhouettes, and cedar detailing echo Beirut's grand residences with Mediterranean softness.",
          tags: ["Stone Arches", "Warm Limestone", "Cedar Wood"],
          learnMore: "Learn More",
        },
        khaleeji: {
          flag: "🇸🇦",
          name: "Khaleeji",
          selectorDescription:
            "Majlis seating · Gold accents · Geometric elegance",
          origin: "Gulf Heritage · التراث الخليجي",
          landingDescription:
            "Majlis comfort, gold detailing, and geometric rhythm create a confident Gulf expression that feels luxurious and contemporary.",
          tags: ["Majlis Seating", "Gold Leaf", "Geometric Patterns"],
          learnMore: "Learn More",
        },
        moroccan: {
          flag: "🇲🇦",
          name: "Moroccan",
          selectorDescription:
            "Zellige tiles · Carved plaster · Vibrant color",
          origin: "Moroccan Heritage · التراث المغربي",
          landingDescription:
            "Zellige, carved plaster, and vivid tones channel the layered craftsmanship of Marrakech riads and Andalusian courtyards.",
          tags: ["Zellige Tiles", "Carved Plaster", "Vibrant Colors"],
          learnMore: "Learn More",
        },
      },
      styleSelector: {
        title: "Choose your style",
        select: "Select",
        selected: "Selected",
      },
      upload: {
        dragPrompt: "Drag your room photo here",
        clickPrompt: "Or click to choose a file",
        formats: "PNG, JPG — up to 10MB",
        invalidType: "The file must be an image (JPG or PNG).",
        invalidSize: "The file size must be under 10MB.",
        invalidDimensions: "Image must be at least 256×256 pixels.",
        previewAlt: "Room preview",
        removeImage: "Remove image",
      },
      footer: {
        about:
          "AI-powered interior design that honors the beauty and craftsmanship of Arabic architectural traditions.",
        quickLinksTitle: "Quick Links",
        techTitle: "Built With",
        poweredBy: "Powered by Turath Engine (محرك تراث)",
        techStack: "SDXL · ControlNet · Cultural LoRA",
        rights: "© 2026 DarDesign. All rights reserved.",
      },
    },
    transform: {
      title: "Transform your room",
      cta: "Transform Room",
      incompleteBoth: "Upload an image and choose a style to continue.",
      incompleteImage: "Upload a room image first.",
      incompleteStyle: "Choose a cultural style first.",
    },
    result: {
      title: "Your redesign",
      download: "Download Image",
      newRoom: "Design Another Room",
      loadingFallback: "Loading...",
      beforeLabel: "Before",
      afterLabel: "After",
    },
    loading: {
      messages: [
        "Analyzing the room...",
        "Drawing from cultural references...",
        "Adding Arabic architectural character...",
        "Finishing the final details...",
      ],
    },
  },
  ar: {
    metadata: {
      title: "دار ديزاين — تصميم داخلي مستوحى من العمارة العربية",
      description:
        "ارفع صورة غرفة، واختر الطراز اللبناني أو الخليجي أو المغربي، وشاهد التحول بالذكاء الاصطناعي خلال ثوانٍ.",
    },
    brand: {
      name: "دار ديزاين",
      engine: "بواسطة محرك تراث",
    },
    controls: {
      languageToggle: "English",
      openMenu: "افتح قائمة التنقل",
      closeMenu: "أغلق قائمة التنقل",
      switchToLight: "التبديل إلى الوضع الفاتح",
      switchToDark: "التبديل إلى الوضع الداكن",
    },
    landing: {
      nav: {
        links: [
          { href: "#home", label: "الرئيسية" },
          { href: "#how-it-works", label: "كيف يعمل" },
          { href: "#styles", label: "الأنماط" },
          { href: "#contact", label: "تواصل" },
        ],
      },
      hero: {
        title: "أعد تصميم مساحتك بروح العمارة العربية",
        subtitle:
          "ارفع صورة غرفتك. اختر الطراز اللبناني أو الخليجي أو المغربي. شاهد التحول بالذكاء الاصطناعي.",
        primaryCta: "ابدأ التصميم",
        secondaryCta: "شاهد الأمثلة",
      },
      socialProof: {
        title: "موثوق من 2,000+ مصمم في الشرق الأوسط",
        metrics: [
          "50 ألف+ غرفة محولة",
          "3 أنماط ثقافية",
          "أقل من 30 ثانية",
          "تقييم 4.9★",
          "مجاني للتجربة",
        ],
      },
      howItWorks: {
        eyebrow: "كيف يعمل",
        title: "تدفق تصميم ثقافي يبدو سلسًا من أول خطوة",
        steps: [
          {
            number: "01",
            icon: "📸",
            title: "ارفع صورة غرفتك",
            description:
              "شارك أي صورة داخلية ودع النموذج يقرأ العمق والتخطيط والإضاءة والإشارات المعمارية فورًا.",
          },
          {
            number: "02",
            icon: "🎨",
            title: "اختر النمط العربي",
            description:
              "اختر اتجاهًا متجذرًا في الذائقة اللبنانية أو الخليجية أو المغربية ضمن تجربة منسقة بعناية.",
          },
          {
            number: "03",
            icon: "✨",
            title: "شاهد التحول",
            description:
              "احصل على تصور متقن خلال ثوانٍ، مع نفس الغرفة ونفس التخطيط ولكن بروح ثقافية جديدة تمامًا.",
          },
        ],
      },
      styles: {
        eyebrow: "أنماط فاخرة",
        title: "ثلاث سلالات تصميمية واضحة ضمن تجربة واحدة مصقولة",
      },
      preview: {
        eyebrow: "قبل وبعد",
        title: "شاهد الفرق",
        before: "قبل",
        after: "بعد",
        description:
          "هذا ما يفعله DarDesign. نفس الغرفة. نفس التخطيط. روح جديدة تمامًا.",
      },
      uploadCta: {
        title: "جاهز للتحويل؟",
        dropzone: "اسحب صورة غرفتك هنا أو اضغط للتصفح",
        support: "يدعم JPG وPNG حتى 10MB",
        footnote: "ابدأ مجانًا. لا حاجة لبطاقة ائتمان.",
      },
    },
    shared: {
      styles: {
        lebanese: {
          flag: "🇱🇧",
          name: "لبناني",
          selectorDescription: "أقواس حجرية · حجر دافئ · خشب أرز",
          origin: "التراث اللبناني · Lebanese Heritage",
          landingDescription:
            "الحجر الجيري الدافئ، والأقواس الثلاثية، وتفاصيل الأرز تعيد أجواء بيوت بيروت الراقية بلمسة متوسطية هادئة.",
          tags: ["أقواس حجرية", "حجر دافئ", "خشب أرز"],
          learnMore: "اعرف المزيد",
        },
        khaleeji: {
          flag: "🇸🇦",
          name: "خليجي",
          selectorDescription: "مجالس فاخرة · لمسات ذهبية · هندسة أنيقة",
          origin: "التراث الخليجي · Gulf Heritage",
          landingDescription:
            "الجلوس المجلسي، والتفاصيل الذهبية، والإيقاع الهندسي يصنعون تعبيرًا خليجيًا واثقًا يجمع الفخامة والحداثة.",
          tags: ["مجالس", "ورق ذهبي", "أنماط هندسية"],
          learnMore: "اعرف المزيد",
        },
        moroccan: {
          flag: "🇲🇦",
          name: "مغربي",
          selectorDescription: "زليج · جص منقوش · ألوان نابضة",
          origin: "التراث المغربي · Moroccan Heritage",
          landingDescription:
            "الزليج والجص المنقوش والألوان المفعمة بالحياة تستحضر حرفية رياض مراكش وساحات الأندلس.",
          tags: ["بلاط زليج", "جص منقوش", "ألوان نابضة"],
          learnMore: "اعرف المزيد",
        },
      },
      styleSelector: {
        title: "اختر الطراز",
        select: "اختر",
        selected: "تم الاختيار",
      },
      upload: {
        dragPrompt: "اسحب صورة الغرفة هنا",
        clickPrompt: "أو اضغط لاختيار ملف",
        formats: "PNG, JPG — حد أقصى 10MB",
        invalidType: "يجب أن يكون الملف صورة (JPG أو PNG).",
        invalidSize: "يجب أن يكون حجم الملف أقل من 10MB.",
        invalidDimensions: "يجب أن تكون أبعاد الصورة 256×256 على الأقل.",
        previewAlt: "معاينة الغرفة",
        removeImage: "إزالة الصورة",
      },
      footer: {
        about:
          "تصميم داخلي بالذكاء الاصطناعي يكرّم جمال وحرفية التقاليد المعمارية العربية.",
        quickLinksTitle: "روابط سريعة",
        techTitle: "مبني باستخدام",
        poweredBy: "مدعوم بمحرك تراث (Turath Engine)",
        techStack: "SDXL · ControlNet · Cultural LoRA",
        rights: "© 2026 دار ديزاين. جميع الحقوق محفوظة.",
      },
    },
    transform: {
      title: "حوّل غرفتك",
      cta: "حوّل الغرفة",
      incompleteBoth: "ارفع صورة واختر الطراز للمتابعة.",
      incompleteImage: "ارفع صورة الغرفة أولًا.",
      incompleteStyle: "اختر الطراز الثقافي أولًا.",
    },
    result: {
      title: "التصميم الجديد",
      download: "حفظ الصورة",
      newRoom: "غرفة جديدة",
      loadingFallback: "جارٍ التحميل...",
      beforeLabel: "قبل",
      afterLabel: "بعد",
    },
    loading: {
      messages: [
        "جارٍ تحليل الغرفة...",
        "نستلهم من المراجع الثقافية...",
        "نضيف الشخصية المعمارية العربية...",
        "اللمسات الأخيرة...",
      ],
    },
  },
} satisfies Record<Language, TranslationShape>;

type Copy = (typeof translations)["en"];

interface ThemeLanguageContextType {
  language: Language;
  theme: Theme;
  isArabic: boolean;
  copy: Copy;
  t: (key: string) => string;
  toggleLanguage: () => void;
  toggleTheme: () => void;
}

const ThemeLanguageContext = createContext<ThemeLanguageContextType | undefined>(
  undefined
);

function getNestedString(source: Record<string, unknown>, key: string): string {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);

  return typeof value === "string" ? value : key;
}

export function ThemeLanguageProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("lang", language);
    html.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
    html.setAttribute("data-theme", theme);
  }, [language, theme]);

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => (current === "en" ? "ar" : "en"));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const copy = useMemo(() => translations[language], [language]);

  const t = useCallback(
    (key: string) => getNestedString(copy as Record<string, unknown>, key),
    [copy]
  );

  const value = useMemo(
    () => ({
      language,
      theme,
      isArabic: language === "ar",
      copy,
      t,
      toggleLanguage,
      toggleTheme,
    }),
    [copy, language, t, theme, toggleLanguage, toggleTheme]
  );

  return (
    <ThemeLanguageContext.Provider value={value}>
      {children}
    </ThemeLanguageContext.Provider>
  );
}

export function useThemeLanguage() {
  const context = useContext(ThemeLanguageContext);

  if (!context) {
    throw new Error(
      "useThemeLanguage must be used within a ThemeLanguageProvider"
    );
  }

  return context;
}
