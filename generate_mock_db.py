#!/usr/bin/env python3
from __future__ import annotations
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
from typing import List, Dict, Any, Tuple
import re

def slugify(name: str) -> str:
    # Lowercase, remove non alphanumerics, collapse spaces
    s = name.lower()
    s = re.sub(r"( inc| llc| ltd| gmbh| s\.a\.| s\.a| corp| co| company| plc)\b", "", s)  # drop common suffixes
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.replace(" ", "")

class IdFactory:
    def __init__(self):
        self.counters = {}

    def next(self, prefix: str) -> str:
        self.counters[prefix] = self.counters.get(prefix, 0) + 1
        return f"{prefix}_{self.counters[prefix]}"

FIRST_NAMES = [
    "Alex","Jordan","Taylor","Casey","Riley","Morgan","Sam","Jamie","Cameron","Avery",
    "Drew","Quinn","Reese","Rowan","Skyler","Parker","Elliot","Hayden","Emerson","Blake",
    "Logan","Harper","Finley","Sage","Remy","Dakota","Tatum","Emery","Kendall","Robin"
]

ORG_NAMES = [
    "Acme Inc","Globex","Initech","Umbrella","Hooli","Stark Industries","Wayne Enterprises",
    "Wonka Labs","Aperture Science","Cyberdyne Systems","Tyrell Corp","Vehement Capital",
    "Gekko & Co","Massive Dynamic","Soylent Works","Monarch Solutions","Octan Energy"
]

PROJECT_NAMES = [
    "Checkout","Billing","Growth","Data Platform","Observability","Mobile App","Web Revamp",
    "Fraud Engine","ML Platform","Realtime Chat","Reporting","Docs","API Gateway","Auth"
]

METRIC_CATALOG = [
    ("http_latency_ms", 30, "active"),
    ("error_rate_pct", 60, "active"),
    ("requests_per_minute", 14, "active"),
    ("cpu_usage_pct", 7, "active"),
    ("memory_usage_mb", 30, "active"),
    ("db_conn_pool_busy_pct", 30, "active"),
]

WIDGET_TYPES = ["timeseries","stat","table","bar"]
SCOPES = ["viewer","dashboard:write","alert:write","metric:write","project:admin"]
PLANS = ["free","pro","enterprise"]

ALERT_NAMES = ["High latency","Error rate spike","High CPU","High memory","RPM drop"]
EVAL_SUITE_NAMES = ["Bot Regression","Smoke Suite","Latency Suite","Alert Rules QA"]

def pick(seq: List[Any]) -> Any:
    return random.choice(seq)

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()

def gen_orgs(idf: IdFactory, n: int) -> List[Dict[str, Any]]:
    names = ORG_NAMES.copy()
    random.shuffle(names)
    orgs = []
    for i in range(n):
        name = names[i % len(names)] if i < len(names) else f"Org {i+1}"
        orgs.append({
            "id": idf.next("org"),
            "name": name,
            "plan": pick(PLANS),
            "active": random.random() > 0.03,
        })
    return orgs

def gen_users(idf: IdFactory, orgs: List[Dict[str, Any]], users_per_org: int) -> List[Dict[str, Any]]:
    users = []
    name_pool = FIRST_NAMES.copy()
    random.shuffle(name_pool)
    name_idx = 0
    for org in orgs:
        domain = slugify(org["name"]) + ".com"
        for u in range(users_per_org):
            user_id = idf.next("usr")
            first = name_pool[name_idx % len(name_pool)]
            name_idx += 1
            email_local = f"{first.lower()}{name_idx}"
            users.append({
                "id": user_id,
                "org_id": org["id"],
                "email": f"{email_local}@{domain}",
                "name": first,
                "role": "admin" if u == 0 else ("member" if random.random() > 0.2 else "viewer"),
                "active": random.random() > 0.02,
            })
    return users

def gen_projects(idf: IdFactory, orgs: List[Dict[str, Any]], projects_per_org: int) -> List[Dict[str, Any]]:
    projects = []
    for org in orgs:
        for p in range(projects_per_org):
            projects.append({
                "id": idf.next("prj"),
                "org_id": org["id"],
                "name": pick(PROJECT_NAMES),
                "visibility": "private" if random.random() > 0.25 else "public",
                "active": random.random() > 0.05,
            })
    return projects

def gen_dashboards(idf: IdFactory, projects: List[Dict[str, Any]], users: List[Dict[str, Any]], dashboards_per_project: int) -> List[Dict[str, Any]]:
    dashboards = []
    # map org -> users for owner assignment
    users_by_org = {}
    for u in users:
        users_by_org.setdefault(u["org_id"], []).append(u)
    for prj in projects:
        org_users = users_by_org.get(prj["org_id"], [])
        for _ in range(dashboards_per_project):
            owner = pick(org_users) if org_users else None
            dashboards.append({
                "id": idf.next("db"),
                "project_id": prj["id"],
                "name": pick(["Ops Overview","Product KPIs","Oncall","SRE Board","Release Readiness"]),
                "owner_user_id": owner["id"] if owner else None,
                "active": random.random() > 0.05,
            })
    return dashboards

def gen_metrics(idf: IdFactory, projects: List[Dict[str, Any]], metrics_per_project: int) -> List[Dict[str, Any]]:
    metrics = []
    for prj in projects:
        used = set()
        for _ in range(metrics_per_project):
            name, retention, status = pick(METRIC_CATALOG)
            # avoid duplicate names within a project
            tries = 0
            while name in used and tries < 10:
                name, retention, status = pick(METRIC_CATALOG)
                tries += 1
            used.add(name)
            metrics.append({
                "id": idf.next("m"),
                "project_id": prj["id"],
                "name": name,
                "retention_days": retention,
                "status": status  # "active" or "archived"
            })
    return metrics

def gen_metric_samples(metrics: List[Dict[str, Any]], samples_per_metric: int) -> List[Dict[str, Any]]:
    samples = []
    base_date = now_utc().date()
    for m in metrics:
        for i in range(samples_per_metric):
            day = base_date - timedelta(days=(samples_per_metric - 1 - i))
            samples.append({
                "metric_id": m["id"],
                "date": day.isoformat(),
                "count": int(random.uniform(80, 200_000))
            })
    return samples

def gen_widgets(idf: IdFactory, dashboards: List[Dict[str, Any]], metrics: List[Dict[str, Any]], widgets_per_dashboard: int) -> List[Dict[str, Any]]:
    widgets = []
    # map project -> metrics to keep widget.metric_id aligned with dashboard.project
    metrics_by_project = {}
    for m in metrics:
        metrics_by_project.setdefault(m["project_id"], []).append(m)

    for db in dashboards:
        prj_metrics = metrics_by_project.get(db["project_id"], [])
        for _ in range(widgets_per_dashboard):
            m = pick(prj_metrics) if prj_metrics else None
            widgets.append({
                "id": idf.next("w"),
                "dashboard_id": db["id"],
                "type": pick(WIDGET_TYPES),
                "metric_id": m["id"] if m else None,
                "title": pick(["Latency P95","Error rate","Traffic","CPU usage","Memory usage","DB pool busy"]),
                "filters": {
                    "env": pick(["prod","staging","dev"]),
                    "region": [pick(["us-east","us-west","eu-west","ap-south"])]
                },
                "visible": random.random() > 0.05,
                "archived": random.random() < 0.05
            })
    return widgets

def gen_alerts(idf: IdFactory, projects: List[Dict[str, Any]], metrics: List[Dict[str, Any]], alerts_per_project: int) -> List[Dict[str, Any]]:
    alerts = []
    metrics_by_project = {}
    for m in metrics:
        metrics_by_project.setdefault(m["project_id"], []).append(m)

    for prj in projects:
        prj_metrics = metrics_by_project.get(prj["id"], [])
        for _ in range(alerts_per_project):
            m = pick(prj_metrics) if prj_metrics else None
            last_fire = now_utc() - timedelta(days=random.randint(0, 7), minutes=random.randint(0, 1440))
            alerts.append({
                "id": idf.next("al"),
                "project_id": prj["id"],
                "name": pick(ALERT_NAMES),
                "metric_id": m["id"] if m else None,
                "threshold": int(random.uniform(50, 1000)),
                "window": pick(["1m","5m","15m","1h"]),
                "enabled": random.random() > 0.1,
                "last_fired_at": iso(last_fire) if random.random() > 0.4 else None
            })
    return alerts

def gen_incidents(idf: IdFactory, alerts: List[Dict[str, Any]], incidents_per_alert: int) -> List[Dict[str, Any]]:
    incidents = []
    for al in alerts:
        for _ in range(incidents_per_alert):
            opened = now_utc() - timedelta(days=random.randint(0, 10), minutes=random.randint(10, 10_000))
            if random.random() > 0.5:
                resolved = opened + timedelta(minutes=random.randint(5, 180))
                status = "resolved"
            else:
                resolved = None
                status = "open"
            incidents.append({
                "id": idf.next("inc"),
                "alert_id": al["id"],
                "status": status,
                "opened_at": iso(opened),
                "resolved_at": iso(resolved) if resolved else None
            })
    return incidents

def gen_eval_suites(idf: IdFactory, projects: List[Dict[str, Any]], suites_per_project: int) -> List[Dict[str, Any]]:
    suites = []
    for prj in projects:
        for _ in range(suites_per_project):
            suites.append({
                "id": idf.next("es"),
                "project_id": prj["id"],
                "name": pick(EVAL_SUITE_NAMES),
                "status": "active" if random.random() > 0.1 else "disabled"
            })
    return suites

def gen_eval_runs(idf: IdFactory, suites: List[Dict[str, Any]], runs_per_suite: int) -> List[Dict[str, Any]]:
    runs = []
    for s in suites:
        for _ in range(runs_per_suite):
            created = now_utc() - timedelta(days=random.randint(0, 5), minutes=random.randint(0, 60*12))
            status = pick(["queued","running","passed","failed"])
            runs.append({
                "id": idf.next("er"),
                "suite_id": s["id"],
                "status": status,
                "created_at": iso(created)
            })
    return runs

def gen_permissions(projects: List[Dict[str, Any]], users: List[Dict[str, Any]], permissions_per_user: int) -> List[Dict[str, Any]]:
    perms = []
    projects_by_org = {}
    for prj in projects:
        projects_by_org.setdefault(prj["org_id"], []).append(prj)

    for u in users:
        available_projects = projects_by_org.get(u["org_id"], [])
        chosen = set()
        for _ in range(min(permissions_per_user, len(available_projects))):
            prj = random.choice(available_projects)
            # avoid duplicate bindings for same user+project
            tries = 0
            while prj["id"] in chosen and tries < 10:
                prj = random.choice(available_projects)
                tries += 1
            chosen.add(prj["id"])
            scopes = random.sample(SCOPES, k=random.randint(1, min(3, len(SCOPES))))
            perms.append({
                "user_id": u["id"],
                "project_id": prj["id"],
                "scopes": scopes
            })
    return perms

def gen_feature_flags(orgs: List[Dict[str, Any]], feature_flags_count: int) -> List[Dict[str, Any]]:
    keys = [
        "widgets.grid_v2","dashboards.public_share","alerts.auto_mute",
        "metrics.rollup_v3","projects.bulk_edit","rbac.granular",
        "eval.live_compare","ui.dark_mode","api.tokens_v2"
    ]
    flags = []
    for i in range(feature_flags_count):
        key = keys[i % len(keys)] if i < len(keys) else f"custom.flag_{i+1}"
        # choose a random subset of orgs for targeted enablement
        enabled_for_orgs = [o["id"] for o in orgs if random.random() > 0.6]
        flags.append({
            "key": key,
            "enabled_for_orgs": enabled_for_orgs,
            "enabled": random.random() > 0.4
        })
    return flags

def gen_audit_logs(idf: IdFactory,
                   orgs: List[Dict[str, Any]], users: List[Dict[str, Any]],
                   projects: List[Dict[str, Any]], dashboards: List[Dict[str, Any]],
                   widgets: List[Dict[str, Any]], alerts: List[Dict[str, Any]],
                   audit_logs_count: int) -> List[Dict[str, Any]]:
    actions = [
        "project.created","project.archived",
        "dashboard.created","dashboard.renamed",
        "widget.created","widget.updated","widget.deleted",
        "alert.created","alert.updated","alert.triggered"
    ]
    # collect possible targets
    ids_pool = []
    ids_pool += [("project", p["id"]) for p in projects]
    ids_pool += [("dashboard", d["id"]) for d in dashboards]
    ids_pool += [("widget", w["id"]) for w in widgets]
    ids_pool += [("alert", a["id"]) for a in alerts]

    logs = []
    for _ in range(audit_logs_count):
        actor = pick(users) if users else None
        target_type, target_id = pick(ids_pool) if ids_pool else (None, None)
        act = pick(actions)
        at = datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 10_000))
        logs.append({
            "id": idf.next("aud"),
            "org_id": actor["org_id"] if actor else (orgs[0]["id"] if orgs else None),
            "actor_user_id": actor["id"] if actor else None,
            "action": act,
            "target_id": target_id,
            "at": at.replace(microsecond=0).isoformat()
        })
    return logs

def build_mock_data(seed: int,
                    orgs_count: int,
                    users_per_org: int,
                    projects_per_org: int,
                    dashboards_per_project: int,
                    widgets_per_dashboard: int,
                    metrics_per_project: int,
                    samples_per_metric: int,
                    alerts_per_project: int,
                    incidents_per_alert: int,
                    suites_per_project: int,
                    runs_per_suite: int,
                    permissions_per_user: int,
                    feature_flags_count: int,
                    audit_logs_count: int) -> Dict[str, Any]:
    random.seed(seed)
    idf = IdFactory()

    orgs = gen_orgs(idf, orgs_count)
    users = gen_users(idf, orgs, users_per_org)
    projects = gen_projects(idf, orgs, projects_per_org)
    dashboards = gen_dashboards(idf, projects, users, dashboards_per_project)
    metrics = gen_metrics(idf, projects, metrics_per_project)
    metric_samples = gen_metric_samples(metrics, samples_per_metric)
    widgets = gen_widgets(idf, dashboards, metrics, widgets_per_dashboard)
    alerts = gen_alerts(idf, projects, metrics, alerts_per_project)
    incidents = gen_incidents(idf, alerts, incidents_per_alert)
    eval_suites = gen_eval_suites(idf, projects, suites_per_project)
    eval_runs = gen_eval_runs(idf, eval_suites, runs_per_suite)
    permissions = gen_permissions(projects, users, permissions_per_user)
    feature_flags = gen_feature_flags(orgs, feature_flags_count)
    audit_logs = gen_audit_logs(idf, orgs, users, projects, dashboards, widgets, alerts, audit_logs_count)

    data = {
        "orgs": orgs,
        "users": users,
        "projects": projects,
        "permissions": permissions,
        "feature_flags": feature_flags,
        "dashboards": dashboards,
        "widgets": widgets,
        "metrics": metrics,
        "metric_samples": metric_samples,
        "alerts": alerts,
        "incidents": incidents,
        "eval_suites": eval_suites,
        "eval_runs": eval_runs,
        "audit_logs": audit_logs
    }
    return data

def main():
    parser = argparse.ArgumentParser(description="Generate a mock JSON database with consistent relationships.")
    parser.add_argument("--out", type=Path, default=Path("mock_db.json"), help="Output JSON path")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--orgs", type=int, default=2)
    parser.add_argument("--users-per-org", type=int, default=3)
    parser.add_argument("--projects-per-org", type=int, default=2)
    parser.add_argument("--dashboards-per-project", type=int, default=1)
    parser.add_argument("--widgets-per-dashboard", type=int, default=2)
    parser.add_argument("--metrics-per-project", type=int, default=2)
    parser.add_argument("--samples-per-metric", type=int, default=5)
    parser.add_argument("--alerts-per-project", type=int, default=1)
    parser.add_argument("--incidents-per-alert", type=int, default=1)
    parser.add_argument("--suites-per-project", type=int, default=1)
    parser.add_argument("--runs-per-suite", type=int, default=2)
    parser.add_argument("--permissions-per-user", type=int, default=2)
    parser.add_argument("--feature-flags-count", type=int, default=3)
    parser.add_argument("--audit-logs-count", type=int, default=10)

    args = parser.parse_args()

    data = build_mock_data(
        seed=args.seed,
        orgs_count=args.orgs,
        users_per_org=args.users_per_org,
        projects_per_org=args.projects_per_org,
        dashboards_per_project=args.dashboards_per_project,
        widgets_per_dashboard=args.widgets_per_dashboard,
        metrics_per_project=args.metrics_per_project,
        samples_per_metric=args.samples_per_metric,
        alerts_per_project=args.alerts_per_project,
        incidents_per_alert=args.incidents_per_alert,
        suites_per_project=args.suites_per_project,
        runs_per_suite=args.runs_per_suite,
        permissions_per_user=args.permissions_per_user,
        feature_flags_count=args.feature_flags_count,
        audit_logs_count=args.audit_logs_count,
    )

    args.out.write_text(json.dumps(data, indent=2))
    print(f"Wrote {args.out.resolve()}")

if __name__ == "__main__":
    main()
