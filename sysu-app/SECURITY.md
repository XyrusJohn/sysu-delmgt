# Security Policy

> **Responsible disclosure:** If you find a security vulnerability, please report it to the maintainers rather than disclosing it publicly. We will work with you to address it.

---

## Reporting a Vulnerability

**Do not file public GitHub issues for security vulnerabilities.**

If you discover a security issue, please:

1. **Do not** disclose it publicly
2. Contact the maintainers privately
3. Include as much detail as possible (steps to reproduce, impact assessment)

The maintainers should acknowledge reports and coordinate remediation privately. No response-time commitment is stated here.

---

## Vulnerability and release status

This policy does not certify the current deployment or dependency vulnerability status. Review the [active fix tracker](docs/FIX_TRACKER.md) and obtain a fresh, lockfile-specific dependency advisory report before making release claims. This audit did not run an advisory scan.

---

## Security Architecture

### Authentication and authorization

The backend uses `protectRoute` and route-specific `authorize` middleware. Check each route to determine its exact access policy. For example, QR token generation and verification are public, while QR admission requires an authenticated driver; queue-card reads and status changes have staff-role restrictions. See [QR routes](backend/src/routes/qrRoute.js), [assignment routes](backend/src/routes/sapAssignmentRoute.js), and the corresponding [authorization tests](backend/tests/integration/authorization.test.js).

### Authorization (RBAC)

Roles and active-account requirements are enforced at the route boundary. The allowlist differs by operation; inspect the current route and authorization middleware rather than relying on a static role summary.

| Role | Capabilities |
| ---- | ------------ |

Role-change and account lifecycle details are tracked in the [fix tracker](docs/FIX_TRACKER.md) and should be verified against their current controllers and tests.

### Rate Limiting

The backend applies three tiers of rate limiting:

| Limiter     | Route                                               | Limit        | Window    |
| ----------- | --------------------------------------------------- | ------------ | --------- |
| Global      | API requests except separately budgeted queue reads | 200 requests | 15 min/IP |
| Auth        | `/api/auth/*`                                       | 20 requests  | 15 min/IP |
| Admin       | `/api/users/*`                                      | 300 requests | 15 min/IP |
| Queue reads | Public queue display and queue cards                | 120 requests | 1 min/IP  |

### QR Token Security

`GET /api/qr/generate` issues a token and `GET /api/qr/verify` checks it without consuming it. `POST /api/qr/scan` requires a valid authenticated driver and validates the driver's identity before queue admission. The current implementation uses cryptographic random bytes and a 48-hour token expiry; successful admission consumes the token transactionally. Recheck [the route](backend/src/routes/qrRoute.js), [controller](backend/src/controllers/qrController.js), and [QR regression tests](backend/tests/unit/qrAndErrors.test.js) when the contract changes.

### Security Headers (Helmet)

The server applies `helmet` middleware which sets:

| Header                      | Value     |
| --------------------------- | --------- |
| `X-Content-Type-Options`    | `nosniff` |
| `X-Frame-Options`           | `DENY`    |
| `Strict-Transport-Security` | Varies    |

CSP is disabled because the legacy frontend uses inline scripts.

### CORS Policy

Origins are validated from `ALLOWED_ORIGINS` by [runtime configuration](backend/src/config/runtime.js) and applied by the CORS middleware. Verify the deployed allowlist separately; source configuration does not prove deployment state.

### Input Validation

- The server limits JSON request bodies to 10 KiB.
- Route schemas and controllers validate the fields relevant to their operations; verify specific limits in their current implementation and tests.

---

## Dependency review

The project declares dependencies in the [frontend manifest](frontend/package.json) and [backend manifest](backend/package.json), with resolved versions in their lockfiles. This policy does not set minimum package versions or claim a clean audit. Review advisories against the exact lockfiles and record dated evidence in the release tracker.

---

## Environment Variables Reference

See `backend/.env.example` and [runtime configuration](backend/src/config/runtime.js) for current requirements. Key security-relevant variables include:

| Variable                        | Purpose                                             | Required                               |
| ------------------------------- | --------------------------------------------------- | -------------------------------------- |
| `ALLOWED_ORIGINS`               | Comma-separated CORS allowlist                      | Yes                                    |
| `TRUST_PROXY`                   | Explicit trusted proxy setting                      | Optional; defaults to no trusted proxy |
| `NODE_ENV`                      | Runtime mode; production has stricter origin checks | Deployment-specific                    |

Never place real credentials in documentation or source control. Deployment values and secret rotation status are outside the scope of this policy and require separately approved operational evidence.
