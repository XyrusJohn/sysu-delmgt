# Testing setup (historical)

This file replaces a workstation-specific setup note dated 2026-10-09. The old instructions targeted existing Firebase Auth, database, and hosted services, so they are not safe or verified as general test instructions.

Use the current project manifests and test scripts. SYSU App backend tests run against isolated MySQL fakes; local app execution requires its configured MySQL database. The former backend Firestore emulator tests and repair scripts have been removed. Historical Firestore data has not been copied to MySQL; see [local MySQL migration status](MIGRATION_RUNBOOK.md) before planning any data import. This page does not certify any workstation configuration or test result.
