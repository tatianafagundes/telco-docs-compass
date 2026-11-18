// Our document row mapped to a TMF667 Document resource. Pure: no I/O.
import type { DocStatus } from "@/schemas/document";
import {
  ERAD_SCHEMA_PATH,
  TMF_BASE_PATH,
  TmfStatus,
  toStandardReferredType,
  toTmfStatus,
} from "@/services/tmf667-shared";
export interface DocRow {
  id: string;
  name: string;
  description: string | null;
  document_type: string;
  status: DocStatus;
  sensitivity: string;
  legal_hold: boolean;
  effective_date: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  characteristic: unknown;
  tenant_id?: string;
  external_identifier?: unknown;
  bundle_id?: string | null;
  registered_by_client?: string | null;
}

/** Extra read-only context for a document reply. */
export interface DocExtras {
  /** Business process names from the document type (TMF GB921), used as `category`. */
  category?: string[];
  /** Other visible documents in the same bundle (TMF DocumentRef). */
  related?: { id: string; role: string }[];
}

/** Category from a document type definition's businessProcess list. */
export function categoryFromDefinition(definition: unknown): string[] {
  const bp =
    typeof definition === "object" && definition !== null
      ? (definition as { businessProcess?: unknown }).businessProcess
      : undefined;
  if (!Array.isArray(bp)) return [];
  return bp
    .map((b) => (typeof b === "object" && b !== null ? (b as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === "string");
}

export interface VersionRow {
  id: string;
  label: string;
  mime_type: string;
  size_bytes: number | null;
  content_hash: string;
  created_at: string;
}

export interface RelationRow {
  entity_id: string;
  role: string;
  referred_type: string;
}

export interface ExternalIdentifier {
  id: string;
  owner?: string;
  externalIdentifierType?: string;
  "@type": "ExternalIdentifier";
}

/**
 * TMF667 v4 Document. Standard fields first; our additions (sensitivity, legalHold, validFor,
 * lifecycleState, attachment contentHash/isCurrent) are declared by @type EradDocument + @schemaLocation.
 */
export interface TmfDocument {
  id: string;
  href: string;
  "@type": "EradDocument";
  "@baseType": "Document";
  "@schemaLocation": string;
  name: string;
  description?: string;
  documentType: string;
  status: TmfStatus;
  creationDate: string;
  lastUpdate: string;
  version?: string;
  documentSpecification: {
    id: string;
    "@referredType": "DocumentSpecification";
    href: string;
    "@type": "DocumentSpecificationRef";
  };
  relatedEntity: { id: string; role: string; "@referredType": string; "@type": "RelatedEntity" }[];
  relatedParty: {
    id: string;
    role: "owner";
    "@referredType": "Organization";
    "@type": "RelatedParty";
  }[];
  externalIdentifier: ExternalIdentifier[];
  attachment: {
    id: string;
    href: string;
    "@type": "Attachment";
    name: string;
    attachmentType: string;
    mimeType: string;
    url: string;
    size?: { amount: number; units: "bytes" };
    contentHash: string;
    creationDate: string;
    isCurrent: boolean;
  }[];
  characteristic: { name: string; value: unknown; valueType?: string }[];
  category?: string[];
  document?: {
    id: string;
    href: string;
    role: string;
    "@referredType": "Document";
    "@type": "DocumentRef";
  }[];
  // Extensions (EradDocument)
  lifecycleState: DocStatus;
  validFor?: { startDateTime?: string; endDateTime?: string };
  sensitivity: string;
  legalHold: boolean;
}

export function asExternalIdentifiers(value: unknown): ExternalIdentifier[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (c): c is { id: string; owner?: unknown; externalIdentifierType?: unknown } =>
        typeof c === "object" && c !== null && typeof (c as { id?: unknown }).id === "string",
    )
    .map((c) => ({
      id: c.id,
      ...(typeof c.owner === "string" ? { owner: c.owner } : {}),
      ...(typeof c.externalIdentifierType === "string"
        ? { externalIdentifierType: c.externalIdentifierType }
        : {}),
      "@type": "ExternalIdentifier" as const,
    }));
}

function asCharacteristics(value: unknown): TmfDocument["characteristic"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (c): c is { name: string; value: unknown; valueType?: string } =>
        typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string",
    )
    .map((c) => ({
      name: c.name,
      value: c.value,
      ...(c.valueType ? { valueType: c.valueType } : {}),
    }));
}

export function toTmfDocument(
  origin: string,
  doc: DocRow,
  versions: VersionRow[],
  relations: RelationRow[],
  extras: DocExtras = {},
): TmfDocument {
  const current = versions.find((v) => v.id === doc.current_version_id);
  const validFor =
    doc.effective_date || doc.expiry_date
      ? {
          ...(doc.effective_date ? { startDateTime: doc.effective_date } : {}),
          ...(doc.expiry_date ? { endDateTime: doc.expiry_date } : {}),
        }
      : undefined;
  const base = `${origin}${TMF_BASE_PATH}/document/${doc.id}`;
  return {
    id: doc.id,
    href: base,
    "@type": "EradDocument",
    "@baseType": "Document",
    "@schemaLocation": `${origin}${ERAD_SCHEMA_PATH}`,
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    documentType: doc.document_type,
    status: toTmfStatus(doc.status),
    creationDate: doc.created_at,
    lastUpdate: doc.updated_at,
    ...(current ? { version: current.label } : {}),
    documentSpecification: {
      id: doc.document_type,
      "@referredType": "DocumentSpecification",
      "@type": "DocumentSpecificationRef",
      href: `${origin}${TMF_BASE_PATH}/documentSpecification/${doc.document_type}`,
    },
    relatedEntity: relations.map((r) => ({
      id: r.entity_id,
      role: r.role,
      "@referredType": toStandardReferredType(r.referred_type),
      "@type": "RelatedEntity",
    })),
    relatedParty: doc.tenant_id
      ? [
          {
            id: doc.tenant_id,
            role: "owner",
            "@referredType": "Organization",
            "@type": "RelatedParty",
          },
        ]
      : [],
    externalIdentifier: asExternalIdentifiers(doc.external_identifier),
    attachment: versions.map((v) => ({
      id: v.id,
      href: `${base}/attachment/${v.id}`,
      "@type": "Attachment",
      name: `Version ${v.label}`,
      attachmentType: doc.document_type,
      mimeType: v.mime_type,
      // Returns a 60-second download link (same key needed).
      url: `${base}/attachment/${v.id}/content`,
      ...(v.size_bytes !== null ? { size: { amount: v.size_bytes, units: "bytes" as const } } : {}),
      contentHash: v.content_hash,
      creationDate: v.created_at,
      isCurrent: v.id === doc.current_version_id,
    })),
    characteristic: asCharacteristics(doc.characteristic),
    ...(extras.category && extras.category.length ? { category: extras.category } : {}),
    ...(extras.related && extras.related.length
      ? {
          document: extras.related.map((r) => ({
            id: r.id,
            href: `${origin}${TMF_BASE_PATH}/document/${r.id}`,
            role: r.role,
            "@referredType": "Document" as const,
            "@type": "DocumentRef" as const,
          })),
        }
      : {}),
    lifecycleState: doc.status,
    ...(validFor ? { validFor } : {}),
    sensitivity: doc.sensitivity,
    legalHold: doc.legal_hold,
  };
}
