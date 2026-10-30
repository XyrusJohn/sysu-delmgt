# Staging deployment status

Staging deployment instructions are retired for the Firebase-backed architecture. The current source uses MySQL and Socket.IO locally, but no staging MySQL service, reverse-proxy configuration, backup plan, or cutover verification has been established.

Do not use the old Firebase Hosting or Firestore instructions from archived release records. The local runbook and current source define the supported developer workflow. Production and staging deployment require a separately reviewed environment and migration plan.
