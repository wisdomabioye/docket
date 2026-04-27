// `server-only` real package throws when imported outside an RSC bundle.
// For tests we want server modules (which `import "server-only"`) to load
// just fine. This shim is aliased in `vitest.config.ts`.
export {};
