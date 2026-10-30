# Documentation index

This index maps the maintained project documentation. Source code, tests, and runtime configuration define actual behavior. Dated reports describe only their recorded scope and do not establish current deployment state.

## Project and policy

- [Project overview and setup](../README.md)
- [Security policy](../SECURITY.md)
- [Repository agent instructions](../AGENTS.md)

## Status and dated acceptance records

- [Project status summary](project-status-summary.md)
- [Web fix and release tracker](FIX_TRACKER.md) (historical findings and checkpoints; verify current status in source and recent evidence)
- [Controlled beta checklist](BETA_CHECKLIST.md) (dated acceptance criteria)
- [Automated release validation evidence](automated-release-validation.md) (dated)
- [Controlled beta deployment record](controlled-beta-deployment-2026-10-14.md) (dated)

## Architecture and operations

- [Frontend guide](frontend-guide.md)
- [Backend API guide](backend-api-guide.md); route source and tests remain authoritative
- [Container deployment](container-deployment.md); API image, Compose setup, and hosting boundaries
- [Staging deployment status](staging-deployment.md); retired Firebase instructions and current staging gaps
- [Local MySQL migration status](MIGRATION_RUNBOOK.md); historical Firestore records are not copied
- [LAMP/MySQL migration assessment](lamp-mysql-migration-assessment.md) (historical; superseded by the current runbook)
- [Live-location review and implementation record](live-location-optimization-plan.md) (dated)
- [System diagnostics](system-diagnostics.md); operational errors, saved runs, and troubleshooting limits

## Historical and retired notes

- [Archive index](archive/README.md)
- [Production release test plan](PRODUCTION_RELEASE_TEST_PLAN_2026-10-07.md) (historical plan)
- [Testing setup](TOMORROW_TESTING.md) (historical workstation instructions replaced with a safe pointer)
