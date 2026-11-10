# 12 — Keycloak

## Realm
- Use one realm, `erad`, per environment.
- Tenants are modelled as groups: `/tenants/aurora`, `/tenants/aurora/se`, `/tenants/aurora/no`. Each group has an attribute `tenant_id`.
- Realm roles: `viewer`, `contributor`, `reviewer`, `manager`, `tenant_admin`, `master_admin`. A user has **exactly one** role and is in **exactly one** tenant group. Admin tooling must enforce this; the app re-checks it.

## Clients
| Client | Type | Use |
|---|---|---|
| erad-web | public, Authorization Code + PKCE | Angular app. Redirect URIs per environment. |
| erad-api | bearer-only (resource server) | Audience for tokens |
| system-<name> | confidential, service account, client credentials | One per connected system (Order care, CPQ, CRM, Ticketing). Attributes: `tenant_id`, `scopes`, `read_limit`, `write_limit`. |

## Token claims (protocol mappers)
| Claim | Source |
|---|---|
| sub | user id (uuid) |
| tenant | group attribute `tenant_id` |
| role | the single realm role |
| name | display name (for "granted by" and activity) |
| scope (systems) | read, register, transition, approve, hold, delete, subscribe |
| tenant (systems) | client attribute `tenant_id` |

- **Access token lifetime:** 5 minutes for people, and 15 minutes for systems (matches the current `eradt_` tokens).
- **Refresh:** a rotating refresh token for the web app.
- **Login:** brute-force protection and breach-password policy are on. The current app rejected weak passwords such as Test123.
- **Key migration:** existing `erad_` keys become client secrets, with a 365-day rotation policy. The old key endpoint can be kept as a shim until the 10 May 2027 sunset.

## Demo users (synthetic, emails only)
| User | Tenant | Role | Record access |
|---|---|---|---|
| master.admin@example.test | aurora | master_admin | – (counts and settings) |
| se.admin@example.test | se | tenant_admin | all Sweden |
| se.manager@example.test | se | manager | all Sweden records |
| se.viewer@example.test | se | viewer | ord-se-7731 only |
| no.manager@example.test | no | manager | both Norway records |

Set passwords per environment in the realm import, never in this pack.

## Spring
- `spring.security.oauth2.resourceserver.jwt.issuer-uri`.
- A `JwtAuthenticationConverter` maps role to authority.
- A `CallerContext` resolver loads `app_user_role` from Cassandra and refuses the request when it doesn't match the token.
