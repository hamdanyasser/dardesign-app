import type { Metadata } from "next";
import UnderstoodRoom from "@/components/dar/UnderstoodRoom";
import "@/components/dar/UnderstoodRoom/understood.css";

export const metadata: Metadata = {
  title: "الغرفة المفهومة — The Understood Room",
  description:
    "صورة واحدة لغرفتك — وثلاثة أجوبة: كيف تبدو، كيف تُرتَّب، وكيف تُسكَن.",
};

export default function V2Page() {
  return <UnderstoodRoom />;
}
