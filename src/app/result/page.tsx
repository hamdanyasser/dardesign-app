import { redirect } from "next/navigation";

/**
 * Retired alongside /transform. The synchronous Studio flow renders the
 * original plus all three styles inline, so there is no longer a separate
 * polling result page. Redirect keeps old links working.
 */
export default function ResultRedirect(): never {
  redirect("/studio");
}
