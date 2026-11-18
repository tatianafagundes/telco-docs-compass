// Our document types mapped to TMF667 DocumentSpecification resources. Pure: no I/O.
import { ERAD_SCHEMA_PATH, TMF_BASE_PATH } from "@/services/tmf667-shared";
export interface SpecRow {
  id: string;
  code: string;
  name: string;
  version: string;
  lifecycle_status: string;
  definition: unknown;
}

/** Our document type status mapped to TMF DocumentSpecificationStatusType; anything unknown reads as not yet in use. */
const SPEC_STATUS: Record<string, "created" | "published" | "archived"> = {
  inDesign: "created",
  active: "published",
  retired: "archived",
};
export function toTmfSpecification(origin: string, s: SpecRow) {
  const def = (typeof s.definition === "object" && s.definition !== null ? s.definition : {}) as {
    specCharacteristic?: unknown;
    acceptedMimeTypes?: unknown;
    maxSizeMb?: unknown;
    validFor?: unknown;
  };
  const chars = Array.isArray(def.specCharacteristic) ? def.specCharacteristic : [];
  const fileRules = [
    ...(Array.isArray(def.acceptedMimeTypes) && def.acceptedMimeTypes.length
      ? [
          {
            name: "acceptedMimeType",
            valueType: "string",
            configurable: false,
            "@type": "CharacteristicSpecification",
            characteristicValueSpecification: def.acceptedMimeTypes.map((m) => ({
              value: m,
              valueType: "string",
            })),
          },
        ]
      : []),
    ...(typeof def.maxSizeMb === "number"
      ? [
          {
            name: "maxSizeMb",
            valueType: "number",
            configurable: false,
            "@type": "CharacteristicSpecification",
            characteristicValueSpecification: [
              { value: def.maxSizeMb, valueType: "number", unitOfMeasure: "MB" },
            ],
          },
        ]
      : []),
  ];
  return {
    id: s.code,
    href: `${origin}${TMF_BASE_PATH}/documentSpecification/${s.code}`,
    "@type": "DocumentSpecification" as const,
    name: s.name,
    version: s.version,
    lifecycleStatus: Object.hasOwn(SPEC_STATUS, s.lifecycle_status)
      ? SPEC_STATUS[s.lifecycle_status]
      : "created",
    "@baseType": "EntitySpecification" as const,
    isBundle: false,
    targetEntitySchema: {
      "@type": "EradDocument",
      "@schemaLocation": `${origin}${ERAD_SCHEMA_PATH}`,
    },
    specCharacteristic: [...chars, ...fileRules],
    ...(typeof def.validFor === "object" && def.validFor !== null
      ? { validFor: def.validFor }
      : {}),
    // Kept until the legacy address is retired; the same rules are in specCharacteristic.
    acceptedMimeTypes: Array.isArray(def.acceptedMimeTypes) ? def.acceptedMimeTypes : [],
    ...(typeof def.maxSizeMb === "number" ? { maxSizeMb: def.maxSizeMb } : {}),
  };
}
