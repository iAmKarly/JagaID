// Server component re-exports the client App. Placing the "use client"
// directive on App.tsx (where it's actually needed) keeps this page a
// proper server component, which is the canonical Next.js App Router pattern.
export { default } from "@/components/App";
