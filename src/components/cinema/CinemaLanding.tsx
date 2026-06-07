"use client";

/* ============================================================
   CinemaLanding — the merged cinematic home.
   Composition mirrors the dar-design-2 home route (app.jsx):
   Boot → Hero → Manifesto → Houses → Interlude → Atlas →
   Interlude → Coda → Colophon, under a fixed mix-blend Chrome.
   ============================================================ */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import CinemaChrome from "./CinemaChrome";
import Boot from "./Boot";
import Hero from "./Hero";
import Manifesto from "./Manifesto";
import Houses from "./Houses";
import Atlas from "./Atlas";
import Interlude from "./Interlude";
import Coda from "./Coda";
import Colophon from "./Colophon";

export default function CinemaLanding() {
  const router = useRouter();
  const { isArabic } = useThemeLanguage();
  const [booted, setBooted] = useState(false);

  // Boot plays once per session; returning from /studio skips it.
  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("dd-booted") === "1") {
      setBooted(true);
    }
  }, []);

  const finishBoot = () => {
    setBooted(true);
    try {
      sessionStorage.setItem("dd-booted", "1");
    } catch {
      /* private mode — ignore */
    }
  };

  const onBegin = () => router.push("/studio");
  const onSee = () =>
    document.querySelector(".houses")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="cinema">
      <CinemaChrome onNavHome={() => window.scrollTo({ top: 0, behavior: "smooth" })} />

      {!booted ? (
        <Boot onDone={finishBoot} />
      ) : (
        <>
          <Hero onBegin={onBegin} onSee={onSee} />
          <Manifesto />
          <Houses />
          <Interlude
            phrase="كُلُّ بَيْتٍ يَحْمِلُ ضَوْءَهُ"
            translation="Every house carries its own light."
            attribution={isArabic ? "مَثَل · Proverb" : "Mathal · Proverb"}
            seed={11}
          />
          <Atlas />
          <Interlude
            phrase="مِنَ الطِّينِ إلى الذَّهَب"
            translation="From clay to gold."
            attribution={isArabic ? "مَقُولَة · From the studio" : "Maqūla · From the studio"}
            seed={23}
          />
          <Coda onBegin={onBegin} />
          <Colophon />
        </>
      )}
    </div>
  );
}
