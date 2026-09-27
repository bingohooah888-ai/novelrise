# NLO Hard Badge Probe

Operational read-only extension for the existing badge pack probe.

- Scans recent PNG files in the local Downloads directory and records filename, SHA-256, byte size, dimensions, and modified time.
- Scans likely NOVELIGHT/badge/Hard ZIP packs and records contained PNG provenance.
- Does not modify Downloads, repository artwork, Production DB, Auth, RLS, Stripe, or secrets.
- Used to pin the exact source bytes before registering Reader Hard 20 + Author Hard 5 artwork.
