-- SYNTHETIC DATA ONLY. Every company, person, number and file below is invented for the prototype.
-- Run after 001. Users cannot be seeded in SQL: sign up the demo users, then call public.seed_demo_access(...) (see prompt 02).

insert into public.tenants (id, display_name, role, parent_tenant_id, frontend_strategy, cross_tenant_share, master_supervision, hard_floors, inheritance) values
 ('aurora-group','Aurora Telecom Group','master',null,'common','explicitGrant','metadataOnly',
  '{"minRetentionDays":1825,"autoAcceptConfidenceAtLeast":0.9,"requireMalwareScan":true}',
  '{}'),
 ('aurora-se','Aurora Mobile Sweden','child','aurora-group','customized','explicitGrant','metadataOnly','{}',
  '{"documentSpecifications":{"mode":"extend"},"retentionPolicies":{"mode":"inherit"},"extractionThresholds":{"mode":"locked"},"statusWorkflow":{"mode":"locked"},"binding":{"mode":"override"}}'),
 ('aurora-no','Aurora Mobile Norway','child','aurora-group','common','off','metadataOnly','{}',
  '{"documentSpecifications":{"mode":"extend"},"retentionPolicies":{"mode":"override"},"extractionThresholds":{"mode":"locked"},"statusWorkflow":{"mode":"locked"},"binding":{"mode":"override"}}');

-- Master-owned document types (shared catalogue). Some locked.
insert into public.document_specifications (id, tenant_id, code, name, version, locked, definition) values
 ('spec-contract','aurora-group','contract','Contract','2',true,
  '{"acceptedMimeTypes":["application/pdf"],"maxSizeMb":50,"requiresReview":true,"signatureRequired":"advanced","defaultSensitivity":"confidential","retentionPolicyRef":"ret-contract",
    "specCharacteristic":[{"name":"contractNumber","valueType":"string","required":true,"extractable":true,"alwaysReview":true},{"name":"counterparty","valueType":"string","required":true,"extractable":true},{"name":"endDate","valueType":"date","required":true,"extractable":true,"alwaysReview":true},{"name":"renewalType","valueType":"enum","enumValues":["automatic","manual"],"extractable":true},{"name":"renewalTermMonths","valueType":"number","extractable":true}]}'),
 ('spec-quote','aurora-group','quote','Quote','1',false,
  '{"acceptedMimeTypes":["application/pdf"],"maxSizeMb":20,"requiresReview":true,"defaultSensitivity":"internal","retentionPolicyRef":"ret-commercial",
    "specCharacteristic":[{"name":"quoteNumber","valueType":"string","required":true,"extractable":true},{"name":"validUntil","valueType":"date","extractable":true}]}'),
 ('spec-orderAttachment','aurora-group','orderAttachment','Order attachment','1',false,
  '{"acceptedMimeTypes":["application/pdf","image/png","image/jpeg","application/zip","application/vnd.openxmlformats-officedocument.wordprocessingml.document"],"maxSizeMb":100,"defaultSensitivity":"internal","retentionPolicyRef":"ret-commercial","specCharacteristic":[]}'),
 ('spec-kycOutcome','aurora-group','kycOutcome','KYC outcome','1',true,
  '{"acceptedMimeTypes":[],"maxSizeMb":0,"defaultSensitivity":"restricted","storesPersonalData":true,"retentionPolicyRef":"ret-kyc",
    "specCharacteristic":[{"name":"decision","valueType":"enum","enumValues":["verified","declined","manualReview"],"required":true},{"name":"verifiedOn","valueType":"date","required":true}]}'),
 ('spec-bill','aurora-group','bill','Bill copy','1',false,
  '{"acceptedMimeTypes":["application/pdf"],"defaultSensitivity":"confidential","retentionPolicyRef":"ret-commercial","specCharacteristic":[]}'),
 ('spec-technicalDoc','aurora-group','technicalDoc','Technical document','1',false,
  '{"acceptedMimeTypes":["application/pdf","image/png"],"maxSizeMb":100,"defaultSensitivity":"internal","retentionPolicyRef":"ret-commercial","specCharacteristic":[{"name":"systemRef","valueType":"string"}]}');
-- Child extends: Norway adds a local type; Sweden overrides the unlocked quote type.
insert into public.document_specifications (id, tenant_id, code, name, version, definition) values
 ('spec-no-regulatoryFiling','aurora-no','regulatoryFiling','Regulatory filing','1',
  '{"acceptedMimeTypes":["application/pdf"],"defaultSensitivity":"confidential","retentionPolicyRef":"ret-no-regulatory","specCharacteristic":[{"name":"authorityRef","valueType":"string","required":true}]}'),
 ('spec-se-quote','aurora-se','quote','Quote (Sweden)','1.1',
  '{"specCharacteristic":[{"name":"quoteNumber","valueType":"string","required":true,"extractable":true},{"name":"validUntil","valueType":"date","extractable":true},{"name":"vatNumber","valueType":"string","extractable":true}]}');

-- Business process per document type, GB921 v26.0.0 (our judgement; see docs/tmf667-mapping.md).
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.12.9.5","name":"Negotiate Sales/Contract"},{"framework":"GB921","release":"26.0.0","id":"1.7.14.5","name":"Manage Contract"}]}'::jsonb where id = 'spec-contract';
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.12.9.2","name":"Develop Sales Proposal"}]}'::jsonb where id in ('spec-quote','spec-se-quote');
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.3.3.12","name":"Manage Customer Order Fulfillment"}]}'::jsonb where id = 'spec-orderAttachment';
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.3.6.1","name":"Create Customer Record"}]}'::jsonb where id = 'spec-kycOutcome';
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.3.9.2","name":"Create Customer Bill Invoice"}]}'::jsonb where id = 'spec-bill';
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.7.21.4","name":"Manage Unstructured Data"}]}'::jsonb where id = 'spec-technicalDoc';
update public.document_specifications set definition = definition || '{"businessProcess":[{"framework":"GB921","release":"26.0.0","id":"1.7.9.8","name":"Manage Regulatory Assurance Framework"}]}'::jsonb where id = 'spec-no-regulatoryFiling';

insert into public.retention_policies (id, tenant_id, code, name, retain_days, locked) values
 ('ret-contract','aurora-group','contract','Contracts: 10 years after end',3650,true),
 ('ret-commercial','aurora-group','commercial','Commercial documents: 7 years',2555,false),
 ('ret-kyc','aurora-group','kyc','KYC outcome: 5 years',1825,true),
 ('ret-no-regulatory','aurora-no','regulatory','Regulatory filings: 10 years',3650,false);

insert into public.business_entities (id, tenant_id, referred_type, display_name, status_label) values
 ('acc-se-1001','aurora-se','Account','Nordlys Retail AB','Active'),
 ('quo-se-0412','aurora-se','Quote','Q-2026-0412 · 480 lines, 5G backup','Awaiting approval'),
 ('ord-se-7731','aurora-se','ProductOrder','O-7731 · Fleet connectivity, 12 sites','In progress'),
 ('cus-se-2209','aurora-se','Customer','Elin Bergqvist (synthetic)','Verified'),
 ('acc-se-1002','aurora-se','Account','Fjärrvärme Syd AB','Active'),
 -- Near-duplicate names so finding "Nordlys Retail AB" is a real search, not a glance (simulated round 1).
 ('acc-se-1003','aurora-se','Account','Nordlys Retail Holding AB','Active'),
 ('acc-se-1004','aurora-se','Account','Nordlys Logistik AB','Active'),
 ('acc-se-1005','aurora-se','Account','Nordic Lights Retail AB','Active'),
 ('acc-se-1006','aurora-se','Account','Norrsken Media AB','Prospect'),
 ('acc-se-1007','aurora-se','Account','Nordlysa Bygg & Fastighet AB','Active'),
 ('acc-se-1008','aurora-se','Account','Retail Partners Nord AB','Inactive'),
 ('acc-no-2001','aurora-no','Account','Fjordtrafikk AS','Active'),
 ('ord-no-5520','aurora-no','ProductOrder','O-5520 · Private 5G pilot','In progress');

-- Sample page generator (PROTOTYPE ONLY): lines with y positions so extraction highlights have somewhere to point.
create or replace function public.sample_pages_for(_title text, _lines text[]) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('page',1,'lines',
    (select jsonb_agg(jsonb_build_object('y', round((0.12 + (i-1)*0.07)::numeric,2), 'text', l) order by i)
     from unnest(array[_title] || _lines) with ordinality as t(l,i))))
$$;

-- Documents (Sweden)
insert into public.documents (id, tenant_id, name, document_type, status, pipeline_state, sensitivity, signature_level, effective_date, expiry_date, retention_policy_id, retain_until, legal_hold, hold_reason, characteristic, created_at) values
 ('00000000-0000-0000-0000-0000000000d1','aurora-se','Master Service Agreement – Nordlys Retail AB','contract','effective','ready','confidential','qualified','2025-03-01','2028-02-29','ret-contract','2038-02-28',false,null,
   '[{"name":"contractNumber","value":"MSA-SE-2025-0187"}]','2025-02-20T10:14:00Z'),
 ('00000000-0000-0000-0000-0000000000d2','aurora-se','Quote Q-2026-0412.pdf','quote','in_review','ready','internal','none',null,'2026-12-15','ret-commercial',null,false,null,
   '[{"name":"quoteNumber","value":"Q-2026-0412"},{"name":"validUntil","value":"2026-12-15"}]','2026-10-28T08:40:00Z'),
 ('00000000-0000-0000-0000-0000000000d3','aurora-se','Photos – 12 sites.zip','orderAttachment','draft','ready','internal','none',null,null,'ret-commercial',null,false,null,'[]','2026-11-05T15:02:00Z'),
 ('00000000-0000-0000-0000-0000000000d4','aurora-se','Signed order form O-7731.pdf','orderAttachment','effective','ready','confidential','advanced','2026-09-12',null,'ret-commercial','2033-09-12',false,null,'[]','2026-09-12T13:21:00Z'),
 ('00000000-0000-0000-0000-0000000000d5','aurora-se','Insurance certificate – subcontractor.pdf','orderAttachment','expired','ready','internal','none','2025-06-01','2026-06-01','ret-commercial',null,false,null,'[]','2025-06-02T09:00:00Z'),
 ('00000000-0000-0000-0000-0000000000d6','aurora-se','KYC outcome – account owner','kycOutcome','effective','ready','restricted','none','2026-10-02',null,'ret-kyc','2031-10-02',false,null,
   '[{"name":"decision","value":"verified"},{"name":"verifiedOn","value":"2026-10-02"}]','2026-10-02T11:30:00Z'),
 ('00000000-0000-0000-0000-0000000000d7','aurora-se','Network design v2 – scan.pdf','technicalDoc','draft','failed','internal','none',null,null,'ret-commercial',null,false,null,'[]','2026-11-04T12:10:00Z'),
 ('00000000-0000-0000-0000-0000000000d8','aurora-se','invoice_copy_final.pdf','orderAttachment','draft','quarantined','internal','none',null,null,'ret-commercial',null,false,null,'[]','2026-11-05T16:45:00Z'),
 ('00000000-0000-0000-0000-0000000000d9','aurora-se','Dispute correspondence – Nordlys','contract','effective','ready','restricted','advanced','2026-07-01',null,'ret-contract','2036-07-01',true,'Pending dispute ref. DSP-2026-031',
   '[{"name":"contractNumber","value":"MSA-SE-2025-0187-ADD"},{"name":"counterparty","value":"Nordlys Retail AB"}]','2026-07-01T09:00:00Z'),
 ('00000000-0000-0000-0000-0000000000da','aurora-se','Fleet connectivity – architecture.pdf','technicalDoc','approved','ready','internal','none',null,null,'ret-commercial',null,false,null,'[{"name":"systemRef","value":"NET-FLEET-04"}]','2026-10-15T10:00:00Z');

-- Documents (Norway, to prove isolation and the locally extended type)
insert into public.documents (id, tenant_id, name, document_type, status, pipeline_state, sensitivity, signature_level, retention_policy_id, characteristic) values
 ('00000000-0000-0000-0000-0000000000e1','aurora-no','Private 5G pilot – agreement.pdf','contract','in_review','ready','confidential','none','ret-contract','[{"name":"contractNumber","value":"MSA-NO-2026-0042"}]'),
 ('00000000-0000-0000-0000-0000000000e2','aurora-no','Spectrum licence filing 2026.pdf','regulatoryFiling','effective','ready','confidential','none','ret-no-regulatory','[{"name":"authorityRef","value":"NKOM-2026-1180"}]'),
 ('00000000-0000-0000-0000-0000000000e3','aurora-no','Site map – pilot.png','orderAttachment','draft','ready','internal','none','ret-commercial','[]');

-- TMF667 v5: validFor = legal/commercial effect; expiryDate = administrative expiry. A contract's end and a quote's validity are validFor.
update public.documents set valid_to = expiry_date, expiry_date = null
  where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
-- A generated document (quote built from a template) and a contract bundle (core + annex), to exercise origin and bundle.
update public.documents set origin = 'generated', generated_from_spec = 'spec-quote'
  where id = '00000000-0000-0000-0000-0000000000d2';
update public.documents set bundle_id = 'bundle-msa-nordlys', bundle_role = 'core' where id = '00000000-0000-0000-0000-0000000000d1';
update public.documents set bundle_id = 'bundle-msa-nordlys', bundle_role = 'annex' where id = '00000000-0000-0000-0000-0000000000d9';

insert into public.document_relations (document_id, entity_id, role) values
 ('00000000-0000-0000-0000-0000000000d1','acc-se-1001','contract'),
 ('00000000-0000-0000-0000-0000000000d2','quo-se-0412','quoteDocument'),
 ('00000000-0000-0000-0000-0000000000d3','ord-se-7731','orderAttachment'),
 ('00000000-0000-0000-0000-0000000000d4','ord-se-7731','orderAttachment'),
 ('00000000-0000-0000-0000-0000000000d5','ord-se-7731','supportingEvidence'),
 ('00000000-0000-0000-0000-0000000000d6','cus-se-2209','kycOutcome'),
 ('00000000-0000-0000-0000-0000000000d7','ord-se-7731','orderAttachment'),
 ('00000000-0000-0000-0000-0000000000d8','ord-se-7731','orderAttachment'),
 ('00000000-0000-0000-0000-0000000000d9','acc-se-1001','contract'),
 ('00000000-0000-0000-0000-0000000000da','ord-se-7731','orderAttachment'),
 ('00000000-0000-0000-0000-0000000000d4','acc-se-1001','contract'),
 ('00000000-0000-0000-0000-0000000000e1','ord-no-5520','contract'),
 ('00000000-0000-0000-0000-0000000000e2','acc-no-2001','supportingEvidence'),
 ('00000000-0000-0000-0000-0000000000e3','ord-no-5520','orderAttachment');

-- Versions. d1 has three: automatic checkpoint, named review draft, named signed version.
insert into public.document_versions (id, document_id, tenant_id, label, is_named, note, mime_type, size_bytes, content_hash, storage_path, sample_pages, supersedes, created_at) values
 ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-0000000000d1','aurora-se','1',false,null,'application/pdf',812340,'sha256:9a1f01','sample/contract',null,null,'2025-02-20T10:14:00Z'),
 ('00000000-0000-0000-0000-00000000a102','00000000-0000-0000-0000-0000000000d1','aurora-se','2 · Legal review',true,'Legal edits to clause 9 (liability)','application/pdf',815012,'sha256:9a1f02','sample/contract',null,'00000000-0000-0000-0000-00000000a101','2025-02-26T14:05:00Z'),
 ('00000000-0000-0000-0000-00000000a103','00000000-0000-0000-0000-0000000000d1','aurora-se','3 · Signed',true,'Signed by both parties','application/pdf',901220,'sha256:9a1f03','sample/contract',
   public.sample_pages_for('MASTER SERVICE AGREEMENT', array['Contract no. MSA-SE-2025-0187','Between Aurora Mobile Sweden and Nordlys Retail AB','Effective date: 1 March 2025','End date: 29 February 2028','Renewal: automatic, 12 months','Liability is limited as set out in clause 9']),
   '00000000-0000-0000-0000-00000000a102','2025-03-01T09:30:00Z'),
 ('00000000-0000-0000-0000-00000000a201','00000000-0000-0000-0000-0000000000d2','aurora-se','1',false,null,'application/pdf',210330,'sha256:b2c001','sample/quote',
   public.sample_pages_for('QUOTE', array['Quote no. Q-2026-0412','480 lines · 5G backup','Valid until 15 December 2026','VAT no. SE000000000001']),null,'2026-10-28T08:40:00Z'),
 ('00000000-0000-0000-0000-00000000a301','00000000-0000-0000-0000-0000000000d3','aurora-se','1',false,null,'application/zip',48200311,'sha256:a3ff01','sample/photos',null,null,'2026-11-05T15:02:00Z'),
 ('00000000-0000-0000-0000-00000000a401','00000000-0000-0000-0000-0000000000d4','aurora-se','1 · Signed',true,null,'application/pdf',330100,'sha256:d4aa01','sample/order',
   public.sample_pages_for('ORDER FORM', array['Order O-7731','Fleet connectivity, 12 sites','Signed: advanced electronic signature']),null,'2026-09-12T13:21:00Z'),
 ('00000000-0000-0000-0000-00000000a501','00000000-0000-0000-0000-0000000000d5','aurora-se','1',false,null,'application/pdf',98010,'sha256:e5bb01','sample/insurance',public.sample_pages_for('CERTIFICATE OF INSURANCE', array['Valid to 1 June 2026']),null,'2025-06-02T09:00:00Z'),
 ('00000000-0000-0000-0000-00000000a601','00000000-0000-0000-0000-0000000000d6','aurora-se','1',false,null,'application/pdf',40210,'sha256:f6cc01',null,null,null,'2026-10-02T11:30:00Z'),   -- KYC: no stored file and no pages; outcome fields only (AGENTS.md rule 8)
 ('00000000-0000-0000-0000-00000000a701','00000000-0000-0000-0000-0000000000d7','aurora-se','1',false,null,'application/pdf',7340011,'sha256:a7dd01','sample/design',null,null,'2026-11-04T12:10:00Z'),
 ('00000000-0000-0000-0000-00000000a801','00000000-0000-0000-0000-0000000000d8','aurora-se','1',false,null,'application/pdf',2201,'sha256:a8ee01',null,null,null,'2026-11-05T16:45:00Z'),
 ('00000000-0000-0000-0000-00000000a901','00000000-0000-0000-0000-0000000000d9','aurora-se','1',false,null,'application/pdf',150001,'sha256:a9ff01','sample/letter',public.sample_pages_for('CORRESPONDENCE', array['Re: invoice dispute','Held pending DSP-2026-031']),null,'2026-07-01T09:00:00Z'),
 ('00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000da','aurora-se','1',false,null,'application/pdf',1200333,'sha256:aa0a01','sample/design',public.sample_pages_for('ARCHITECTURE', array['System ref NET-FLEET-04','Edge, core and backup path']),null,'2026-10-15T10:00:00Z'),
 ('00000000-0000-0000-0000-00000000b101','00000000-0000-0000-0000-0000000000e1','aurora-no','1',false,null,'application/pdf',700100,'sha256:b1a101','sample/contract',null,null,now()),
 ('00000000-0000-0000-0000-00000000b201','00000000-0000-0000-0000-0000000000e2','aurora-no','1',false,null,'application/pdf',300100,'sha256:b2a201','sample/letter',null,null,now()),
 ('00000000-0000-0000-0000-00000000b301','00000000-0000-0000-0000-0000000000e3','aurora-no','1',false,null,'image/png',1900100,'sha256:b3a301','sample/map',null,null,now());

update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a103' where id = '00000000-0000-0000-0000-0000000000d1';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a201' where id = '00000000-0000-0000-0000-0000000000d2';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a301' where id = '00000000-0000-0000-0000-0000000000d3';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a401' where id = '00000000-0000-0000-0000-0000000000d4';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a501' where id = '00000000-0000-0000-0000-0000000000d5';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a601' where id = '00000000-0000-0000-0000-0000000000d6';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a701', pipeline_detail = '{"failedStep":"extraction","reasonKey":"doc.extraction.unreadable","retryable":true}' where id = '00000000-0000-0000-0000-0000000000d7';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a801', pipeline_detail = '{"failedStep":"scan","reasonKey":"doc.scan.threatFound","retryable":false}' where id = '00000000-0000-0000-0000-0000000000d8';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000a901' where id = '00000000-0000-0000-0000-0000000000d9';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000aa01' where id = '00000000-0000-0000-0000-0000000000da';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000b101' where id = '00000000-0000-0000-0000-0000000000e1';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000b201' where id = '00000000-0000-0000-0000-0000000000e2';
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000b301' where id = '00000000-0000-0000-0000-0000000000e3';

-- Extraction on the signed contract (v3) and the quote: all three bands, one already reviewed.
insert into public.extraction_fields (document_id, version_id, tenant_id, name, value, confidence, band, source, status) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000a103','aurora-se','contractNumber','"MSA-SE-2025-0187"',0.98,'high','{"page":1,"box":{"x":0.10,"y":0.19,"w":0.45,"h":0.04},"excerpt":"Contract no. MSA-SE-2025-0187"}','accepted'),
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000a103','aurora-se','counterparty','"Nordlys Retail AB"',0.93,'high','{"page":1,"box":{"x":0.10,"y":0.26,"w":0.70,"h":0.04},"excerpt":"Between Aurora Mobile Sweden and Nordlys Retail AB"}','pending'),
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000a103','aurora-se','endDate','"2028-02-29"',0.81,'medium','{"page":1,"box":{"x":0.10,"y":0.40,"w":0.50,"h":0.04},"excerpt":"End date: 29 February 2028"}','pending'),
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000a103','aurora-se','renewalTermMonths','12',0.58,'low','{"page":1,"box":{"x":0.10,"y":0.47,"w":0.50,"h":0.04},"excerpt":"Renewal: automatic, 12 months"}','pending'),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000a201','aurora-se','quoteNumber','"Q-2026-0412"',0.97,'high','{"page":1,"box":{"x":0.10,"y":0.19,"w":0.40,"h":0.04},"excerpt":"Quote no. Q-2026-0412"}','pending'),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000a201','aurora-se','vatNumber','"SE000000000001"',0.66,'low','{"page":1,"box":{"x":0.10,"y":0.40,"w":0.45,"h":0.04},"excerpt":"VAT no. SE000000000001"}','pending');

-- Nordlys (task 2) is an EFFECTIVE contract, so its details are all confirmed: the key facts answer task 2 directly.
-- (An effective contract with required details unconfirmed would be incoherent on screen; the review found this.)
insert into public.extraction_fields (document_id, version_id, tenant_id, name, value, confidence, band, source, status) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000a103','aurora-se','renewalType','"automatic"',0.86,'medium','{"page":1,"box":{"x":0.10,"y":0.47,"w":0.50,"h":0.04},"excerpt":"Renewal: automatic, 12 months"}','accepted');
update public.extraction_fields set status = 'accepted' where document_id = '00000000-0000-0000-0000-0000000000d1';
update public.documents set characteristic = '[{"name":"contractNumber","value":"MSA-SE-2025-0187"},{"name":"counterparty","value":"Nordlys Retail AB"},{"name":"endDate","value":"2028-02-29"},{"name":"renewalType","value":"automatic"},{"name":"renewalTermMonths","value":12}]'::jsonb
 where id = '00000000-0000-0000-0000-0000000000d1';

-- USABILITY TEST CONTRACT (task 4). Separate from Nordlys so task 2 is never contaminated. In review, so Approve exists.
-- Two PLANTED errors: counterparty "AS" at High (page says AB) tests over-trust; renewal 24 at Low (page says 12).
insert into public.documents (id, tenant_id, name, document_type, status, pipeline_state, sensitivity, signature_level, retention_policy_id, characteristic, created_at) values
 ('00000000-0000-0000-0000-0000000000db','aurora-se','Master Service Agreement – Fjärrvärme Syd AB','contract','in_review','ready','confidential','none','ret-contract','[]','2026-11-03T09:00:00Z');
insert into public.document_relations (document_id, entity_id, role) values ('00000000-0000-0000-0000-0000000000db','acc-se-1002','contract');
insert into public.document_versions (id, document_id, tenant_id, label, is_named, note, mime_type, size_bytes, content_hash, storage_path, sample_pages, supersedes, created_at) values
 ('00000000-0000-0000-0000-00000000ab01','00000000-0000-0000-0000-0000000000db','aurora-se','1',false,null,'application/pdf',640220,'sha256:db0101','sample/contract',
   public.sample_pages_for('MASTER SERVICE AGREEMENT', array['Contract no. MSA-SE-2026-0311','Between Aurora Mobile Sweden and Fjärrvärme Syd AB','Effective date: 1 January 2027','End date: 31 December 2029','Renewal: automatic, 12 months','Notice period: 90 days']),
   null,'2026-11-03T09:00:00Z');
update public.documents set current_version_id = '00000000-0000-0000-0000-00000000ab01' where id = '00000000-0000-0000-0000-0000000000db';
insert into public.extraction_fields (document_id, version_id, tenant_id, name, value, confidence, band, source, status, spot_check) values
 ('00000000-0000-0000-0000-0000000000db','00000000-0000-0000-0000-00000000ab01','aurora-se','contractNumber','"MSA-SE-2026-0311"',0.97,'high','{"page":1,"box":{"x":0.10,"y":0.19,"w":0.45,"h":0.04},"excerpt":"Contract no. MSA-SE-2026-0311"}','pending',false),
 ('00000000-0000-0000-0000-0000000000db','00000000-0000-0000-0000-00000000ab01','aurora-se','counterparty','"Fjärrvärme Syd AS"',0.95,'high','{"page":1,"box":{"x":0.10,"y":0.26,"w":0.70,"h":0.04},"excerpt":"Between Aurora Mobile Sweden and Fjärrvärme Syd AB"}','pending',false),
 ('00000000-0000-0000-0000-0000000000db','00000000-0000-0000-0000-00000000ab01','aurora-se','endDate','"2029-12-31"',0.84,'medium','{"page":1,"box":{"x":0.10,"y":0.40,"w":0.50,"h":0.04},"excerpt":"End date: 31 December 2029"}','pending',false),
 ('00000000-0000-0000-0000-0000000000db','00000000-0000-0000-0000-00000000ab01','aurora-se','renewalType','"automatic"',0.88,'medium','{"page":1,"box":{"x":0.10,"y":0.47,"w":0.50,"h":0.04},"excerpt":"Renewal: automatic, 12 months"}','pending',false),
 ('00000000-0000-0000-0000-0000000000db','00000000-0000-0000-0000-00000000ab01','aurora-se','renewalTermMonths','24',0.62,'low','{"page":1,"box":{"x":0.10,"y":0.47,"w":0.50,"h":0.04},"excerpt":"Renewal: automatic, 12 months"}','pending',false);

insert into public.document_events (tenant_id, document_id, actor, action, detail, created_at) values
 ('aurora-se','00000000-0000-0000-0000-0000000000d1',null,'upload','Version 1','2025-02-20T10:14:00Z'),
 ('aurora-se','00000000-0000-0000-0000-0000000000d1',null,'statusChange','draft to in_review','2025-02-24T09:00:00Z'),
 ('aurora-se','00000000-0000-0000-0000-0000000000d1',null,'statusChange','approved to effective','2025-03-01T09:31:00Z'),
 ('aurora-se','00000000-0000-0000-0000-0000000000d9',null,'hold','Hold set: Pending dispute ref. DSP-2026-031','2026-07-02T08:00:00Z'),
 ('aurora-se','00000000-0000-0000-0000-0000000000d8',null,'pipelineStateChange','scanning to quarantined (threat found)','2026-11-05T16:46:00Z');

-- Demo access: after signing up a demo user, call this once per user.
create or replace function public.seed_demo_access(_user uuid, _tenant text, _role public.app_role, _name text, _all_entities boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles (user_id, tenant_id, role, display_name) values (_user, _tenant, _role, _name) on conflict do nothing;
  insert into public.profiles (user_id, tenant_id, display_name) values (_user, _tenant, _name) on conflict do nothing;
  if _all_entities then
    insert into public.entity_access (entity_id, user_id, level)
      select id, _user, case when _role in ('manager','tenant_admin','reviewer') then 'edit'::public.access_level else 'view'::public.access_level end
      from public.business_entities where tenant_id = _tenant on conflict do nothing;
  end if;
end $$;
revoke execute on function public.seed_demo_access(uuid, text, public.app_role, text, boolean) from public, anon, authenticated;
revoke execute on function public.sample_pages_for(text, text[]) from public, anon, authenticated;
-- After the demo users are set up, DROP seed_demo_access (prompt 02 step C): it must not remain callable in a deployed prototype.
