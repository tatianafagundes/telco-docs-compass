// The server functions screens call to read and change documents, listed in one place for
// `api.ts`. The work is in the files below, split by what they do:
//
//   document-read.functions.ts     find, content link, list access (reads)
//   document-content.functions.ts  register, edit details, add a version
//   document-status.functions.ts   status moves, legal hold, delete, restore
//   document-review.functions.ts   send back with a problem, review extracted details
//   document-access.functions.ts   grant and revoke access
//   document-detail-entry.functions.ts   enter a required detail that was not read
export * from "@/services/document-read.functions";
export * from "@/services/document-content.functions";
export * from "@/services/document-status.functions";
export * from "@/services/document-review.functions";
export * from "@/services/document-access.functions";
export * from "@/services/document-detail-entry.functions";
