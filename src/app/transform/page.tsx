import { redirect } from "next/navigation";

/**
 * Retired. The old upload → pick-one-style → poll flow has been replaced by the
 * Studio (/studio), which sends a single `POST /redesign` and returns the
 * original plus all three redesigns at once. Kept as a redirect so existing
 * links and bookmarks don't 404.
 */
export default function TransformRedirect(): never {
  redirect("/studio");
}
