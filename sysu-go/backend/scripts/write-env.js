// Retired: embedded IAM credentials must never be copied into local/generated files.
console.error('Credential writer retired. Configure replacement credentials in the deployment secret store.');
process.exitCode = 1;
