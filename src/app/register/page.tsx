"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import AuthForm, { AuthField } from "@/components/AuthForm";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { isArabic } = useThemeLanguage();
  const { signUp } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (en: string, ar: string) => (isArabic ? ar : en);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Checked here as well as on the server: catching a typo before the request
    // is kinder than a round-trip, but the server stays the authority.
    if (password !== confirm) {
      setError(t("The passwords do not match.", "كلمتا المرور غير متطابقتين."));
      return;
    }
    if (password.length < 6) {
      setError(
        t("Password must be at least 6 characters.", "يجب أن تتكون كلمة المرور من ٦ أحرف على الأقل."),
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signUp({ fullName, phoneNumber: phoneNumber || undefined, email, password });
      router.push("/studio");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? isArabic
            ? err.message_ar
            : err.message_en
          : t("Could not create the account.", "تعذّر إنشاء الحساب."),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthForm
      title={t("Create your account", "أنشئ حسابك")}
      subtitle={t(
        "Save your designs and return to them any time.",
        "احفظ تصاميمك وعُد إليها في أي وقت.",
      )}
      submitLabel={t("Create account", "إنشاء الحساب")}
      pendingLabel={t("Creating…", "جارٍ الإنشاء…")}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      footer={
        <>
          {t("Already have an account?", "لديك حساب بالفعل؟")}{" "}
          <Link href="/login" className="text-[var(--dd-gold)] hover:underline">
            {t("Sign in", "تسجيل الدخول")}
          </Link>
        </>
      }
    >
      <AuthField
        id="fullName"
        label={t("Full name", "الاسم الكامل")}
        value={fullName}
        onChange={setFullName}
        autoComplete="name"
      />
      <AuthField
        id="phoneNumber"
        type="tel"
        label={t("Phone number (optional)", "رقم الهاتف (اختياري)")}
        value={phoneNumber}
        onChange={setPhoneNumber}
        required={false}
        autoComplete="tel"
        placeholder="+961 …"
      />
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
        autoComplete="new-password"
      />
      <AuthField
        id="confirm"
        type="password"
        label={t("Confirm password", "تأكيد كلمة المرور")}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
    </AuthForm>
  );
}
