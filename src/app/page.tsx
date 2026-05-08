import type { Metadata } from "next";
import "@/components/atelier/atelier.css";
import AtelierApp from "@/components/atelier/AtelierApp";

export const metadata: Metadata = {
  title: "Dar · The Atelier of Arabic Interiors",
  description:
    "A bilingual AI atelier for Arabic interior design. Upload a room, choose Lebanese, Khaleeji, or Moroccan, and watch a photograph translate into a tradition.",
};

export default function HomePage() {
  return <AtelierApp />;
}
