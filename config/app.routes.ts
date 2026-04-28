/**
 * Internal page routes. Every `<Link href>`, `redirect()`, `router.push()`
 * passes through here — no hardcoded path strings in pages or components.
 *
 * Static paths are bare strings; parameterized paths are functions.
 */

export const APP_ROUTES = {
  // Public / marketing
  home: "/",
  pricing: "/pricing",
  terms: "/terms",
  privacy: "/privacy",

  // Auth (SSO-only)
  login: "/login",
  authCallback: "/auth/callback",
  authError: "/auth/error",

  // Attorney app
  dashboard: "/dashboard",
  onboarding: "/onboarding",
  newCase: "/case/new",
  case: (id: string) => `/case/${id}`,
  caseIntake: (id: string) => `/case/${id}/intake`,
  caseDocuments: (id: string) => `/case/${id}/documents`,
  caseDocument: (caseId: string, documentId: string) =>
    `/case/${caseId}/documents/${documentId}`,
  caseBuild: (id: string) => `/case/${id}/build`,
  caseOutputs: (id: string) => `/case/${id}/outputs`,
  output: (caseId: string, outputId: string) =>
    `/case/${caseId}/outputs/${outputId}`,
  casePackage: (id: string) => `/case/${id}/package`,
  settings: "/settings",

  // Admin
  admin: "/admin",
  adminAttorneys: "/admin/attorneys",
  adminWaitlist: "/admin/waitlist",
  adminCases: "/admin/cases",
  adminRevenue: "/admin/revenue",
  adminCompute: "/admin/compute",
  adminAuditLog: "/admin/audit-log",
} as const;

export type AppRoutes = typeof APP_ROUTES;

/** Routes an unauthenticated user is allowed to visit. Read by `proxy.ts` (Stage 02). */
export const PUBLIC_ROUTES: readonly string[] = [
  APP_ROUTES.home,
  APP_ROUTES.pricing,
  APP_ROUTES.terms,
  APP_ROUTES.privacy,
  APP_ROUTES.login,
  APP_ROUTES.authCallback,
  APP_ROUTES.authError,
];
