# Security policy

## Supported versions

Security fixes are provided for the latest published Folio release.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's private vulnerability reporting for `srsatt/folio` instead. Include affected versions, reproduction steps, impact, and any suggested mitigation.

You should receive an acknowledgement within seven days. A fix and disclosure timeline depends on severity and reproducibility.

## Local trust boundary

Folio treats report source as untrusted input. Repository files and report data remain local unless the user explicitly binds `folio serve` to a network interface or shares a downloaded report. Network serving requires `--allow-network`; remote clients cannot open repository source files, and served metadata omits the absolute repository root.
