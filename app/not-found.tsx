import type { Metadata } from "next";
import { StatusPage } from "@/components/ui/StatusPage";

export const metadata: Metadata = { title: "Page not found · Vowlet" };

/**
 * Shown for a URL that doesn't exist and when a page calls notFound(). A vendor
 * link is the likely way here in the demo: Reset demo (and the 30-minute
 * auto-reset) recreate every id, so a link from an old tab no longer matches.
 */
export default function NotFound() {
  return (
    <StatusPage heading="We couldn't find that page">
      <p>It may have been moved, or the link may be out of date.</p>
      <p className="text-sm">In the shared demo, a vendor page disappears when the demo is reset. Open the vendor again from the dashboard.</p>
    </StatusPage>
  );
}
