# APP_NAME documentation

Specs are the source of truth. Code follows them; deviations need a decision-log entry in
[`00-locked-decisions.md`](00-locked-decisions.md) **before** merge.

## Product & architecture specs

| Doc | Contents |
|---|---|
| [00-locked-decisions.md](00-locked-decisions.md) | Locked product/architecture decisions + decision log |
| [phase-2/](phase-2/) | UX: design system & navigation, customer / business / admin screens |
| [phase-3/](phase-3/) | Database: schema, booking engine, trust, discovery, RLS, required tests |
| [phase-4/01-implementation-plan.md](phase-4/01-implementation-plan.md) | Milestones M0–M14, gates A–D |

## Engineering

| Doc | Contents |
|---|---|
| [engineering/getting-started.md](engineering/getting-started.md) | Prerequisites, install, run, common commands |
| [engineering/environments.md](engineering/environments.md) | Local / staging / production, env variables, secrets |
| [engineering/conventions.md](engineering/conventions.md) | Repo layout, naming, migrations, code review checklist |
| [engineering/testing.md](engineering/testing.md) | Test layers, where tests live, CI jobs |

## Milestone reports

| Milestone | Report |
|---|---|
| M0 Project foundation | [milestones/M0-report.md](milestones/M0-report.md) |
| M1 Database foundations | [milestones/M1-report.md](milestones/M1-report.md) |
| M2 Business core schema | [milestones/M2-report.md](milestones/M2-report.md) |
| M3 Booking engine | [milestones/M3-report.md](milestones/M3-report.md) |
| M4 Auth, identity & claim model | [milestones/M4-report.md](milestones/M4-report.md) |
| M5 Business dashboard I | [milestones/M5-report.md](milestones/M5-report.md) |
