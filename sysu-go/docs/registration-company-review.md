# Registration company and queue confirmation review

## Findings (2026-10-14)

- `RegistrationActivity` collected trucking company but wrote only identity/contact fields to `users/{uid}`. Company was retained only in shared preferences. A pending login calls `clearSession()`, which erases it. The account already exists in `users` before approval; approval is not evidence of a collection transfer.
- Login preferred `drivers/{uid}` and otherwise used a device session value. New pending registrations did not create that driver profile. Company can therefore disappear, and an unscoped session fallback is not authoritative account data.
- QR admission creates `status: waiting, registrationComplete: false` before `/api/trip/register` executes. A rejected second request leaves a provisional entry. Existing source already retries authentication once, preserves the queue ID, and reconciles ambiguous registration failures against server state. These fixes must also exist in the installed/deployed versions.
- The app concatenates extra helpers into `helperLN`, while registration limits that field to 50 characters and admission limits the combined helper name to 100. This can reject registration after consuming a QR.

## Changes

- Persist bounded `truckingCompany` on the user profile during registration; retain it through approval and use it as the login fallback behind the existing driver profile. Remove the unscoped device fallback at login.
- Add this non-authority profile field to local Firestore create/update validation; role/status restrictions remain intact.
- Read legacy `truckCompany` when prefilling trip registration.
- Treat waiting/called entries without explicit confirmation as pending in home and queue details; clear stale shipment display on the pending path.
- Validate combined helper and phone lengths before admission so known incompatible input cannot consume a QR.

## Verification and release requirements

- Backend trip ownership/registration tests: 18 passed.
- Android `:app:compileDebugKotlin :app:testDebugUnitTest --tests com.sysu.go.network.TripRegistrationFlowTest --tests com.sysu.go.firebase.AccountPolicyTest`: BUILD SUCCESSFUL.
- `git diff --check`: passed.
- Added a Firestore regression covering pending company persistence, foreign writes, length bounds, and rejected self-approval. Not executed: no Firestore emulator was listening on port 8085.
- No production rules deployment, APK installation, account migration, commit, or push performed. The actual live error category remains unverified.
- Deploy the reviewed company-field rule change to the shared Firebase project before shipping the updated registration client. Reconcile the sibling web repository's rule source first; do not overwrite production with this entire local rules file, which contains pre-existing changes outside this review.
- Existing accounts whose company was never stored require the driver to enter it again; successful trip registration already writes it to `drivers/{uid}` transactionally. Do not infer a real company or bulk-update existing users.
- Long multiple-helper support still requires a separate structured API contract; this patch blocks incompatible input without truncating names. Live acceptance must exercise pending sign-in, approval, sign-in on a fresh session, rejected confirmation, retry of the same queue ID, and a lost-response scenario on the installed APK and deployed backend.
