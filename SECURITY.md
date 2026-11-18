# Security policy

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Sarif-02/ClipFlow/security/advisories/new) once enabled for the repository. If the form is unavailable, ask a maintainer privately for a reporting channel. Use public issues for ordinary bugs.

Include the ClipFlow version or commit, platform, a short impact description, and sanitized reproduction details using synthetic data when possible. Keep credentials, OAuth tokens, private URLs, real media, transcripts, database files, and exploit details out of public reports. If a credential was exposed, revoke or rotate it with the provider.

ClipFlow is a single-user, unauthenticated application for HTTP loopback. Optional Instagram OAuth adds a dedicated HTTPS callback listener on loopback. Public deployment, shared-host access, and running behind an exposed tunnel are outside the supported security model. Restrict OS access and keep the encryption key, local configuration, database, and backups private.

Security fixes target the latest maintained release.
