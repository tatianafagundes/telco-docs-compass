import { createFileRoute } from "@tanstack/react-router";
import { HoldsPage } from "@/components/holds/holds-page";

export const Route = createFileRoute("/_authenticated/admin/holds")({
  head: () => ({
    meta: [
      { title: "Holds and retention · Admin" },
      { name: "description", content: "Legal holds, retention policies in force and deletion history." },
      { property: "og:title", content: "Holds and retention · Admin" },
      { property: "og:description", content: "Legal holds, retention policies in force and deletion history." },
    ],
  }),
  component: HoldsPage,
});
