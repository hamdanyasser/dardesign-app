import type { Metadata } from "next";
import "./atelier.css";
import AtelierApp from "./AtelierApp";

export const metadata: Metadata = {
  title: "Dar · The Atelier — DarDesign",
  description:
    "A cinematic scrollytelling for DarDesign. Seven acts: threshold, three houses, alchemy, atlas, the door.",
};

export default function AtelierPage() {
  return <AtelierApp />;
}
