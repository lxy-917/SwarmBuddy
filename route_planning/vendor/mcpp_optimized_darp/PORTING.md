# Upstream and Python integration

Upstream: https://github.com/savvas-ap/mCPP-optimized-DARP (MIT license).
The files in this directory are upstream Java source at the repository's
`main` branch as retrieved on 2026-11-10. `LICENSE` is the upstream license.

The running SwarmBuddy service uses
`route_planning/tools/allocation/darp_coverage.py`, a Python adaptation of
the DARP **area assignment** stage. It ports distance-metric cell assignment,
area-balance correction, and connected-component correction. It then makes
scan lines inside each assigned polygon and validates all connectors against
the existing maritime obstacle and restricted-area geometry.

The upstream simulated-annealing grid orientation/shift optimization and STC
trajectory generation are retained here for reference but are not yet ported.
The Python route and coverage metrics must therefore be evaluated on local
sea-area examples before claiming equivalence with the published Java results.
The old `optimize_route` API parameter is rejected in DARP mode until a
separate route optimizer is ported.
