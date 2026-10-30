# SYSU Go documentation index

Current guides describe selected source-verified behavior; route source, tests, build configuration, and approved requirements define the contract. Dated evidence is limited to its recorded run and does not prove deployed behavior.

## Start here

- [Repository overview and isolated setup](../README.md)
- [Android app guide](android-app-guide.md)
- [Backend API and socket contract](backend-api-guide.md)
- [Container deployment status](container-deployment.md); remote/container startup is not verified for local-only MySQL
- [Retired emulator setup](LOCAL_EMULATOR_SETUP.md); pointer for dated records
- [Local MySQL migration status](mysql-migration-status.md)

## Status and release evidence

- [Project status summary](project-status-summary.md)
- [Fix tracker](FIX_TRACKER.md)
- [Cross-project integration checklist](INTEGRATION_CHECKLIST.md)
- [Release test plan](RELEASE_TEST_PLAN.md)
- [Executed release evidence](RELEASE_FIXES_TDD.md)
- [Recent registration review](registration-company-review.md)
- [Queue confirmation evidence](queue-confirmation-tdd.md)
- [Queue position recovery evidence](queue-position-recovery-2026-10-09.md)
- [Historical Google login recovery evidence](GOOGLE_LOGIN_RECOVERY_2026-10-09.md)
- [Activity log](activity-log.md)

## Data and architecture references

- The shared local schema is maintained in the sibling `sysu-app/backend/src/migrations/mysql/` directory. Historical design specifications and plans remain under superpowers/; treat them as design records unless current source and tracker evidence confirm implementation.
- [Archived documents](archive/README.md)

Use the trackers for current acceptance state. Confirm any command, target project, build variant, or deployment against current source and configuration before running it.
