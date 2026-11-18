// TMF667 gateway for connected systems (Order care, Ticket management, CRM, CPQ).
//
// This file only names what the rest of the app and the tests use; the work is in the files
// below, each with its own header:
//
//   gateway-core.ts         who is calling (authenticate), JSON bodies, loading a document
//   gateway-idempotency.ts  Idempotency-Key and the activity record
//   gateway-reads.ts        list, get, download link, document specifications
//   gateway-create.ts       POST /document (input shapes: gateway-create-input.ts)
//   gateway-patch.ts        PATCH /document/{id}
//   gateway-changes.ts      status moves, legal hold, delete
//   gateway-hub.ts          event subscriptions
//   gateway-routing.ts      unsupported methods, unknown paths, legacy marker
//   gateway-token.ts        POST /oauth/token
export { MAX_BODY_CHARS, authenticate, type SystemCtx } from "@/services/gateway-core";
export { MAX_INLINE_BYTES } from "@/services/gateway-create-input";
// Other modules (event delivery) and the tests reach the address check through the gateway.
export { resolvesPublic } from "@/services/gateway-fetch";
export { errorReply } from "@/services/gateway-reply";
export {
  getAttachmentContent,
  getDocument,
  getSpecification,
  listDocuments,
  listSpecifications,
} from "@/services/gateway-reads";
export { createDocument } from "@/services/gateway-create";
export { patchDocument } from "@/services/gateway-patch";
export { deleteDocument, setLegalHold, transitionDocument } from "@/services/gateway-changes";
export { subscribe, unsubscribe } from "@/services/gateway-hub";
export { legacy, otherMethods, unknownPath } from "@/services/gateway-routing";
export { issueToken, TOKEN_TTL_SECONDS } from "@/services/gateway-token";
