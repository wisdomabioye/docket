"use client";

/**
 * Top-level PostHog provider mounted in `app/layout.tsx`.
 *
 * Three responsibilities:
 *   1. Init `posthog-js` exactly once on first mount, gated on the
 *      public env var. No env var = silent no-op (the analytics
 *      wrappers in `lib/analytics/client.ts` also no-op via
 *      `posthog.__loaded`).
 *   2. Disable PostHog's automatic pageview capture and emit our own
 *      from a `usePathname` + `useSearchParams` effect. Auto-capture
 *      is unreliable across Next 16's mixed RSC + soft-navigation
 *      model — manual fires are deterministic and match what the
 *      product team queries against.
 *   3. Fan-out children unchanged. The provider does NOT render any
 *      DOM of its own.
 *
 * Mount placement: root layout, NOT the workspace layout. We want
 * pageviews from the marketing site, signup pages, and onboarding
 * counted under one anonymous distinct_id that later merges into the
 * user's profile via `posthog.identify()` (called from
 * `<PostHogIdentify>` inside the workspace layout).
 *
 * `useSearchParams` Suspense requirement: per Next 16's
 * `useSearchParams` docs, any Client Component that reads search
 * params forces the closest `Suspense` boundary above it to be CSR.
 * The pageview reader is isolated in `<PostHogPageView>` and wrapped
 * in `<Suspense>` here so the rest of the tree stays prerenderable.
 */

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { publicEnv } from "@/config/public-env";

let initAttempted = false;

/** Init synchronously at first render. Why not `useEffect`: child
 *  effects fire BEFORE parent effects in React, so a `useEffect`-driven
 *  init runs AFTER `<PostHogPageView>`'s first effect — which would see
 *  `posthog.__loaded === false` and silently drop the cold-load
 *  pageview (the most important one). The `typeof window` guard keeps
 *  this safe under SSR: this module is `"use client"`, but Next still
 *  evaluates client modules on the server during HTML generation, and
 *  `posthog-js` touches `window` on init. */
function initPostHog(): void {
  if (initAttempted) return;
  if (typeof window === "undefined") return;
  initAttempted = true;
  if (!publicEnv.posthogKey) return;
  posthog.init(publicEnv.posthogKey, {
    api_host: publicEnv.posthogHost ?? "https://us.i.posthog.com",
    // We fire `$pageview` manually from the effect below — see the
    // file header for why auto-capture is unreliable on Next 16.
    capture_pageview: false,
    // Pageleave needs an upstream pageview to attach to; turning
    // pageview off would otherwise drop pageleaves silently. The
    // explicit `'if_capture_pageview'` keeps both subsystems in sync.
    capture_pageleave: "if_capture_pageview",
    // Default since 1.197+, but spelled out so a future upgrade can't
    // silently flip the policy and start creating person profiles for
    // every anonymous marketing-page visit (which would burn MAU).
    person_profiles: "identified_only",
    // Session recording is off until/unless we explicitly add it as a
    // workstream — turning it on at init would start uploading
    // attorney + beneficiary screen frames to PostHog, which is a
    // PII risk we have not signed off on.
    disable_session_recording: true,
  });
}

/** Inner reader — isolated so its `useSearchParams` call only triggers
 *  Suspense for itself, not the whole app tree. */
function PostHogPageView(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog.__loaded) return;
    if (!pathname) return;
    // Build the URL with search params so PostHog's session timeline
    // shows e.g. `/case/abc?tab=outputs` instead of just `/case/abc`.
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  // Synchronous init in the render path so `posthog.__loaded` is true
  // by the time `<PostHogPageView>`'s mount effect fires. See
  // `initPostHog` for why `useEffect` would be too late.
  initPostHog();

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </>
  );
}
