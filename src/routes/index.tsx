import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Documents · Telecom document workspace" },
      { name: "description", content: "Find, check and share telecom contracts, quotes and order documents." },
      { property: "og:title", content: "Documents · Telecom document workspace" },
      { property: "og:description", content: "Find, check and share telecom contracts, quotes and order documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/documents" });
  },
});
