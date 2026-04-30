import Link from "next/link";
import { APP_INFO, APP_ROUTES } from "@/config";

/**
 * Stage 11 marketing footer. Mirrors `landing.html` footer area:
 * brand block left, link columns right, fine-print row at bottom.
 */
export function MarketingFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer
      className="border-t"
      style={{
        background: "var(--surface, #fafaf6)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
        color: "var(--ink-soft, var(--ink))",
      }}
    >
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="text-lg font-bold tracking-[-0.02em]">
              {APP_INFO.name}
              <span style={{ color: "var(--accent, var(--ink))" }}>.</span>
            </p>
            <p
              className="mt-2 max-w-xs text-sm"
              style={{ color: "var(--ink-muted)" }}
            >
              {APP_INFO.tagline}
            </p>
          </div>
          <FooterColumn
            heading="Product"
            links={[
              { label: "How it works", href: "/#how" },
              { label: "Pricing", href: APP_ROUTES.pricing },
              { label: "FAQ", href: "/#faq" },
            ]}
          />
          <FooterColumn
            heading="Account"
            links={[
              { label: "Sign in", href: APP_ROUTES.login },
              { label: "Join waitlist", href: "/waitlist" },
            ]}
          />
          <FooterColumn
            heading="Legal"
            links={[
              { label: "Terms", href: APP_ROUTES.terms },
              { label: "Privacy", href: APP_ROUTES.privacy },
            ]}
          />
        </div>
        <div
          className="mt-10 border-t pt-6 text-xs"
          style={{
            borderColor: "var(--border, rgba(0,0,0,0.08))",
            color: "var(--ink-muted)",
          }}
        >
          © {year} {APP_INFO.name}. Built for solo immigration attorneys.
        </div>
      </div>
    </footer>
  );
}

function FooterColumn(props: {
  heading: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}): React.ReactElement {
  return (
    <div>
      <p
        className="text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: "var(--ink-muted)" }}
      >
        {props.heading}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {props.links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="transition hover:text-[var(--ink)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
