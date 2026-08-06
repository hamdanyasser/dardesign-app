"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import AuthForm, { AuthField } from "@/components/AuthForm";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { isArabic } = useThemeLanguage();
  const { signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (en: string, ar: string) => (isArabic ? ar : en);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
      router.push("/studio");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? isArabic
            ? err.message_ar
            : err.message_en
          : t("Could not sign in. Please try again.", "تعذّر تسجيل الدخول. حاول مجدداً."),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthForm
      title={t("Welcome back", "أهلاً بعودتك")}
      subtitle={t("Sign in to reach your saved designs.", "سجّل الدخول للوصول إلى تصاميمك المحفوظة.")}
      submitLabel={t("Sign in", "تسجيل الدخول")}
      pendingLabel={t("Signing in…", "جارٍ الدخول…")}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      footer={
        <>
          {t("No account yet?", "ليس لديك حساب؟")}{" "}
          <Link href="/register" className="text-[var(--dd-gold)] hover:underline">
            {t("Create one", "أنشئ حساباً")}
          </Link>
        </>
      }
    >
      <AuthField
        id="email"
        type="email"
        label={t("Email", "البريد الإلكتروني")}
        value={email}
        onChange={setEmail}
        autoComplete="email"
        placeholder="you@example.com"
      />
      <AuthField
        id="password"
        type="password"
        label={t("Password", "كلمة المرور")}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
    </AuthForm>
  );
}
