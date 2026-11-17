---
inclusion: auto
name: product
description: What Telco Docs Compass is, who uses it, the roles, and the document status path. Read before changing behaviour that a person or another system can see.
---
# Product

Document management for telecom operators, as a prototype with synthetic data. Documents (contracts, quotes, order attachments, site surveys) belong to business records. A person adds a document, details are read from it and checked by a person, a second person approves it, and it becomes effective. Other systems use the same documents through the TMF667 Document Management API.

## People and roles

Roles, lowest to highest: `viewer`, `contributor`, `reviewer`, `manager`, `tenant_admin`, `master_admin`. The rules are in `can()`, `transitionCapability()` and the `*State` functions of `src/services/document-rules.ts` and `document-actions.ts`:

- Send for review and edit details: contributor and above.
- Check details and approve: reviewer and above.
- Make effective, supersede, expire, place or release a legal hold, delete (soft, recoverable): manager and above.
- Delete permanently (leaves a tombstone): `tenant_admin` and `master_admin` only.

The master admin (the group) sees counts and settings, never documents.

## Status path

`draft`, `in_review`, `approved`, `effective`, then `superseded` or `expired`, then `archived`. Only forward; send-back is the one way to return. Approval waits until every required detail was confirmed by a person. The person who added a document cannot approve it.

## Organisations

A group has countries (tenants). A person sees their own tenant and documents explicitly shared with them. Settings such as document types and policies are inherited from the group and can be locked by it.

## Connected systems

A system gets its own key, sees one tenant only, has its own rate limits, and every action it takes appears in the document's activity. It can subscribe to change events.

## Tone of the screens

Plain, calm English. Say what happened and what the person can do next. Unavailable actions show why.
