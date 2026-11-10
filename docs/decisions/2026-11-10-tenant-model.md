# Tenant model: group sees counts and settings only
The group admin (master_admin) manages shared document types, locks and hard floors for its child tenants, and reads their settings and document counts (`master_document_stats`, SECURITY DEFINER, counts only). It never reads document names or content. Confirmed by the product owner on 10 Nov 2026.
