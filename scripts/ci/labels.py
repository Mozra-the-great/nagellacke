#!/usr/bin/env python3
"""Apply the label taxonomy in .github/labels.json to GitHub.

Goal: every issue and every PR carries labels that say what it is (type/),
where it lives (area/, topic/) and how urgent it is (prio/), so triage does not
start by reading the text. Hand-maintained labels drift, so the taxonomy lives
in the repo as code and this script enforces it. Ported from homelab-infra
(scripts/ci/labels.py there), extended by what this repo's titles already carry:
Conventional-Commit scopes on PRs (`fix(android): ...`) and `[Web]`/`[Server]`
tags on issues.

Subcommands (all through the `gh` CLI, preinstalled on ubuntu-latest):

    sync             Create/update labels, rename aliases.
                     NEVER deletes a label -- a foreign label does not silently
                     vanish from the issues it is on.
    pr <nr>          Label a PR by changed paths, title prefix/scope and the
                     labels of the issues it closes.
    issue <nr>       Label an issue by its title tags; an open issue without
                     prio/ or status/ label also gets status/triage.
    backfill [--all] `pr` for every open PR, `issue` for every open issue;
                     with --all also the closed/merged ones (no triage there).

Everything is additive: labels are never removed from issues/PRs, hand-set ones
stay.

Standard library only, so it runs in a bare CI container without a pip step.
"""
from __future__ import annotations

import fnmatch
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
CONFIG = REPO / ".github" / "labels.json"
TRIAGE = "status/triage"


def load_config(path: pathlib.Path = CONFIG) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# -- pure decision logic (tested in test_labels.py) -------------------------

def labels_for_paths(paths: list[str], rules: dict[str, list[str]]) -> set[str]:
    """All labels whose glob matches at least one changed path.

    fnmatch `*` also spans `/`, so `**/x/**` hits `x` at any depth and `*.md`
    hits every Markdown file in the tree.
    """
    found: set[str] = set()
    for path in paths:
        for pattern, labels in rules.items():
            if fnmatch.fnmatchcase(path, pattern):
                found.update(labels)
    return found


_CONVENTIONAL = re.compile(r"\s*([A-Za-z0-9]+)(?:\(([^)]*)\))?!?:")


def labels_for_title(title: str, prefixes: dict[str, list[str]],
                     scopes: dict[str, list[str]] | None = None) -> set[str]:
    """Conventional-Commit prefix and scope, e.g. `fix(android,sync)!: ...`."""
    m = _CONVENTIONAL.match(title)
    if not m:
        return set()
    found = set(prefixes.get(m.group(1).lower(), []))
    if scopes and m.group(2):
        for scope in re.split(r"[,/\s]+", m.group(2).lower()):
            found.update(scopes.get(scope, []))
    return found


_LEADING_TAGS = re.compile(r"\s*((?:\[[^\]]*\]\s*)+)")


def labels_for_issue_title(title: str, config: dict) -> set[str]:
    """Labels from how issue titles are written in this repo.

    - leading bracket tags, possibly several and combined:
      `[Server/Web] ...`, `[Low/Medium][Security] ...`
    - a leading keyword: `Bug; Upload not working`, `Feat - Passkey ...`
    - a Conventional-Commit title, same rules as for PRs
    """
    found: set[str] = set()
    tags = config.get("issue_tags", {})
    m = _LEADING_TAGS.match(title)
    rest = title
    if m:
        rest = title[m.end():]
        for group in re.findall(r"\[([^\]]*)\]", m.group(1)):
            for tag in re.split(r"[/,]", group):
                found.update(tags.get(tag.strip().lower(), []))
    lowered = rest.strip().lower()
    for word, labels in config.get("title_words", {}).items():
        if re.match(re.escape(word) + r"(?![a-z0-9])", lowered):
            found.update(labels)
    found |= labels_for_title(rest, config.get("title_prefixes", {}),
                              config.get("title_scopes", {}))
    return found


def only_docs(paths: list[str]) -> bool:
    """Only Markdown changed? Path-based rather than label-based: docs/sync.md
    also carries area/sync, but is still documentation only."""
    return bool(paths) and all(p.endswith(".md") for p in paths)


def known_labels(config: dict) -> set[str]:
    return {lab["name"] for lab in config["labels"]}


def inherited_labels(issue_labels: set[str], config: dict) -> set[str]:
    """What a PR takes over from the issues it closes: type/area/topic/prio,
    never status/ -- a triage or blocked marker belongs to the issue."""
    prefixes = tuple(config.get("inherit_prefixes", []))
    return {lab for lab in issue_labels if prefixes and lab.startswith(prefixes)}


def pr_labels(title: str, paths: list[str], config: dict,
              issue_labels: set[str] | None = None) -> set[str]:
    labels = labels_for_paths(paths, config["paths"])
    labels |= labels_for_title(title, config["title_prefixes"],
                               config.get("title_scopes", {}))
    if only_docs(paths):
        labels.add("type/docs")
    if issue_labels:
        labels |= inherited_labels(issue_labels, config)
    # Two closed issues can carry different priorities.
    return single_prio(labels & known_labels(config), config)


def single_prio(labels: set[str], config: dict) -> set[str]:
    """At most one prio/ label: `[Low/Medium]` yields both, keep the higher.
    Rank is the order in labels.json, most urgent first."""
    order = [lab["name"] for lab in config["labels"] if lab["name"].startswith("prio/")]
    prios = sorted((lab for lab in labels if lab in order), key=order.index)
    return labels - set(prios[1:])


def issue_labels(title: str, config: dict) -> set[str]:
    return single_prio(labels_for_issue_title(title, config) & known_labels(config),
                       config)


def pr_final_labels(wanted: set[str], have: set[str], exists: set[str]) -> set[str]:
    """What actually gets set on a PR.

    Only labels that already exist: before the first `sync` on main the API
    would otherwise silently create an unknown label -- grey, no description,
    and in the end a duplicate next to the real one. The triage fallback
    applies only *after* that filter, otherwise a PR whose path labels were all
    filtered out would end up with no label at all.
    """
    final = (wanted - have) & exists
    if any(lab.startswith("prio/") for lab in have):
        final = {lab for lab in final if not lab.startswith("prio/")}
    if not final and not have:
        final = {TRIAGE} & exists
    return final


def issue_final_labels(wanted: set[str], have: set[str], exists: set[str],
                       is_open: bool) -> set[str]:
    """What actually gets set on an issue.

    Unlike PRs, an issue is untriaged until someone gave it a priority or a
    status -- the area/type labels derived from the title say nothing about
    whether anyone looked at it. Closed issues are history and never get
    status/triage. A priority someone already set is never contradicted by
    one derived from the title.
    """
    final = (wanted - have) & exists
    if any(lab.startswith("prio/") for lab in have):
        final = {lab for lab in final if not lab.startswith("prio/")}
    after = have | final
    triaged = any(lab.startswith(("prio/", "status/")) for lab in after)
    if is_open and not triaged:
        final |= {TRIAGE} & exists
    return final


def plan_sync(existing: dict[str, dict], wanted: list[dict]) -> list[tuple]:
    """Actions to reach `wanted`. existing: name -> {color, description}.

    Returns a list of ("create", name, color, desc),
    ("rename", old, new, color, desc) and ("update", old, new, color, desc).
    An alias is renamed only when the target label does not exist yet --
    GitHub would reject the rename otherwise.
    """
    lower = {name.lower(): name for name in existing}
    actions: list[tuple] = []
    for lab in wanted:
        name, color = lab["name"], lab["color"].lower()
        desc = lab.get("description", "")
        current = lower.get(name.lower())
        if current is not None:
            cur = existing[current]
            if (cur.get("color", "").lower() != color
                    or (cur.get("description") or "") != desc
                    or current != name):
                actions.append(("update", current, name, color, desc))
            continue
        alias = next((lower[a.lower()] for a in lab.get("aliases", [])
                      if a.lower() in lower), None)
        if alias is not None:
            actions.append(("rename", alias, name, color, desc))
            del lower[alias.lower()]
        else:
            actions.append(("create", name, color, desc))
        lower[name.lower()] = name
    return actions


# -- GitHub side ------------------------------------------------------------

def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, text=True,
                          capture_output=True, encoding="utf-8").stdout


def cmd_sync(config: dict) -> None:
    existing = {lab["name"]: lab for lab in
                json.loads(gh("label", "list", "--limit", "1000",
                              "--json", "name,color,description"))}
    for action in plan_sync(existing, config["labels"]):
        kind = action[0]
        if kind == "create":
            _, name, color, desc = action
            gh("label", "create", name, "--color", color, "--description", desc)
        else:
            _, old, name, color, desc = action
            gh("label", "edit", old, "--name", name, "--color", color,
               "--description", desc)
        print(f"{kind}: {action[1]}" + (f" -> {action[2]}" if kind != "create" else ""))


def existing_labels() -> set[str]:
    return {lab["name"] for lab in
            json.loads(gh("label", "list", "--limit", "1000", "--json", "name"))}


def add_labels(kind: str, number: str, labels: set[str]) -> None:
    # REST rather than `gh pr edit --add-label`: the latter goes through
    # GraphQL and fails in some gh versions on the Projects-classic sunset.
    # Issues and PRs share the same label endpoint.
    if labels:
        args = ["api", "--method", "POST",
                f"repos/{{owner}}/{{repo}}/issues/{number}/labels"]
        for lab in sorted(labels):
            args += ["-f", f"labels[]={lab}"]
        gh(*args)
    print(f"{kind} #{number}: {', '.join(sorted(labels)) or '(nothing)'}")


def cmd_pr(config: dict, number: str, exists: set[str] | None = None) -> None:
    data = json.loads(gh("pr", "view", number, "--json",
                         "title,files,labels,closingIssuesReferences"))
    paths = [f["path"] for f in data.get("files", [])]
    from_issues: set[str] = set()
    for ref in data.get("closingIssuesReferences") or []:
        issue = json.loads(gh("issue", "view", str(ref["number"]),
                              "--json", "labels"))
        from_issues |= {lab["name"] for lab in issue.get("labels", [])}
    labels = pr_labels(data["title"], paths, config, from_issues)
    have = {lab["name"] for lab in data.get("labels", [])}
    if exists is None:
        exists = existing_labels()
    add_labels("pr", number, pr_final_labels(labels, have, exists))


def cmd_issue(config: dict, number: str, exists: set[str] | None = None) -> None:
    data = json.loads(gh("issue", "view", number, "--json", "title,labels,state"))
    have = {lab["name"] for lab in data.get("labels", [])}
    # Same guard as in cmd_pr: an issue opened before the first (or after a
    # failed) sync must not create grey stand-in labels.
    if exists is None:
        exists = existing_labels()
    wanted = issue_labels(data["title"], config)
    add_labels("issue", number, issue_final_labels(
        wanted, have, exists, data.get("state") == "OPEN"))


def items(include_closed: bool) -> list[tuple[int, bool]]:
    """Issues and PRs as (number, is_pr), fully paginated.

    The issues endpoint returns PRs too; `--paginate` follows the Link headers
    instead of silently cutting off after N entries like `gh ... list --limit N`.
    """
    state = "all" if include_closed else "open"
    out = gh("api", "--paginate",
             f"repos/{{owner}}/{{repo}}/issues?state={state}&per_page=100",
             "--jq", ".[] | [.number, (.pull_request != null)] | @tsv")
    result = []
    for line in out.splitlines():
        number, is_pr = line.split("\t")
        result.append((int(number), is_pr == "true"))
    return result


def cmd_backfill(config: dict, include_closed: bool) -> None:
    # Fetch the label list once per run rather than once per issue/PR --
    # otherwise the backfill costs one extra API call per item.
    exists = existing_labels()
    for number, is_pr in items(include_closed):
        if is_pr:
            cmd_pr(config, str(number), exists)
        else:
            cmd_issue(config, str(number), exists)


def main(argv: list[str]) -> int:
    commands = {"sync", "pr", "issue", "backfill"}
    if not argv or argv[0] not in commands or (argv[0] in {"pr", "issue"} and len(argv) < 2):
        print(__doc__, file=sys.stderr)
        return 2
    config = load_config()
    if argv[0] == "sync":
        cmd_sync(config)
    elif argv[0] == "pr":
        cmd_pr(config, argv[1])
    elif argv[0] == "issue":
        cmd_issue(config, argv[1])
    else:
        cmd_backfill(config, "--all" in argv[1:])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
