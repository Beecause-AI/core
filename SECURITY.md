# Security Policy

## Supported Versions

We accept vulnerability reports against the **latest commit on `master`**.
Older releases are not maintained with security patches.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Because Beecause handles authentication and sits on the critical path of incident response, we treat security reports with high priority.

Report vulnerabilities through **GitHub's private Security Advisory** flow:

> **[https://github.com/Beecause-AI/core/security/advisories/new](https://github.com/Beecause-AI/core/security/advisories/new)**

A maintainer will acknowledge your report within **72 hours** and aim to issue a patch or mitigation within **14 days**, depending on severity.

Please include:

- A clear description of the vulnerability and its impact.
- Steps to reproduce or a proof-of-concept (a private draft advisory lets you attach files).
- The affected component(s) (e.g. auth adapter, API endpoint, LLM tool surface).
- Your suggested severity (CVSS score welcome but not required).

## Scope

In-scope:
- Authentication bypass or privilege escalation (`AUTH_BACKEND=local`, OIDC flows).
- Injection attacks (SQL, prompt injection reaching sensitive data).
- Secrets leakage through API responses or logs.
- Denial-of-service via crafted inputs to the analysis engine.

Out-of-scope:
- Issues requiring physical access to the host.
- Vulnerabilities in upstream dependencies that are already publicly disclosed upstream.
- Self-inflicted misconfigurations (e.g. deploying with `AUTH_BACKEND=none` on a public host).

## Disclosure Policy

We follow **responsible disclosure**: once a fix is available we will publish a GitHub Security Advisory and credit the reporter (unless anonymity is requested).
