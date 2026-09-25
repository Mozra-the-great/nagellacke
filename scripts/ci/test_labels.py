#!/usr/bin/env python3
"""Unit tests for labels.py.

labels.py gates nothing, but it fails the way every silent automation fails: a
pattern that never matches leaves PRs unlabelled with a green run. Each test
below pins a decision that, if it silently inverted, would drop labels without
anyone noticing.

Standard library only, like the script itself:

    python3 -m unittest discover -s scripts/ci -p "test_*.py"
"""
from __future__ import annotations

import pathlib
import subprocess
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import labels as lbl  # noqa: E402


class TestConfig(unittest.TestCase):
    CONFIG = lbl.load_config()

    def test_only_known_labels_referenced(self):
        # A typo in a rule would otherwise run into the void without an error,
        # because pr_labels()/issue_labels() filter unknown names out.
        known = lbl.known_labels(self.CONFIG)
        used: set[str] = set()
        for key in ("paths", "title_prefixes", "title_scopes", "issue_tags",
                    "title_words"):
            used |= {x for v in self.CONFIG[key].values() for x in v}
        self.assertEqual(used - known, set())

    def test_colors_and_unique_names(self):
        names = [lab["name"].lower() for lab in self.CONFIG["labels"]]
        aliases = [a.lower() for lab in self.CONFIG["labels"]
                   for a in lab.get("aliases", [])]
        self.assertEqual(len(names), len(set(names)))
        # An alias that is also a target name would be renamed onto itself.
        self.assertEqual(set(names) & set(aliases), set())
        for lab in self.CONFIG["labels"]:
            self.assertRegex(lab["color"], r"^[0-9a-fA-F]{6}$", lab["name"])
            self.assertLessEqual(len(lab.get("description", "")), 100, lab["name"])

    def test_every_repo_path_gets_a_label(self):
        # Every PR carries at least one label, so every tracked file -- top
        # level included -- has to be matched by at least one pattern.
        files = subprocess.run(["git", "ls-files"], cwd=lbl.REPO, text=True,
                               capture_output=True, check=True).stdout.split()
        missing = [f for f in files
                   if not lbl.labels_for_paths([f], self.CONFIG["paths"])]
        self.assertEqual(missing, [])

    def test_every_area_label_is_reachable_from_a_path(self):
        # An area/ label no path rule produces is only ever set by hand -- the
        # usual sign of a directory rename the rules missed.
        produced = {x for v in self.CONFIG["paths"].values() for x in v}
        areas = {n for n in lbl.known_labels(self.CONFIG)
                 if n.startswith(("area/", "topic/"))}
        self.assertEqual(areas - produced, set())


class TestPrLabels(unittest.TestCase):
    CONFIG = lbl.load_config()

    def test_path_in_depth_hits_area_and_topic(self):
        got = lbl.pr_labels("x", ["v3/server/src/photoToken.ts"], self.CONFIG)
        self.assertIn("area/server", got)
        self.assertIn("topic/photos", got)

    def test_android_sync_adapter(self):
        got = lbl.pr_labels(
            "x", ["android/app/src/main/java/de/nagellacke/data/sync/DropboxAdapter.kt"],
            self.CONFIG)
        self.assertEqual(got, {"area/android", "area/sync"})

    def test_title_prefix_and_scope(self):
        got = lbl.labels_for_title("fix(android,sync)!: x",
                                   self.CONFIG["title_prefixes"],
                                   self.CONFIG["title_scopes"])
        self.assertEqual(got, {"type/bug", "area/android", "area/sync"})
        self.assertEqual(lbl.labels_for_title("Fix the thing", {"fix": ["type/bug"]}),
                         set())
        # Unknown scope: prefix still counts.
        self.assertEqual(lbl.labels_for_title("feat(nope): x", {"feat": ["type/feature"]},
                                              {"web": ["area/web"]}),
                         {"type/feature"})

    def test_only_docs_becomes_type_docs(self):
        self.assertIn("type/docs", lbl.pr_labels("x", ["README.md"], self.CONFIG))
        # Docs with an area label stay docs.
        self.assertIn("type/docs", lbl.pr_labels("x", ["docs/sync.md"], self.CONFIG))
        # As soon as code is involved, no longer.
        self.assertNotIn("type/docs", lbl.pr_labels(
            "x", ["README.md", "v3/server/src/index.ts"], self.CONFIG))

    def test_inherits_type_area_prio_but_not_status(self):
        got = lbl.pr_labels("fix: x", ["v3/apps/web/src/App.tsx"], self.CONFIG,
                            {"prio/high", "type/a11y", "status/triage", "question"})
        self.assertIn("prio/high", got)
        self.assertIn("type/a11y", got)
        self.assertNotIn("status/triage", got)
        self.assertNotIn("question", got)

    def test_triage_fallback_after_existence_filter(self):
        # Path labels present but not created yet -> still triage.
        self.assertEqual(lbl.pr_final_labels({"area/ci"}, set(), {lbl.TRIAGE}),
                         {lbl.TRIAGE})
        # Nothing exists -> set nothing (no grey stand-in label).
        self.assertEqual(lbl.pr_final_labels({"area/ci"}, set(), set()), set())
        # Hand-set label -> no triage on top.
        self.assertEqual(lbl.pr_final_labels(set(), {"prio/low"}, {lbl.TRIAGE}), set())


class TestIssueLabels(unittest.TestCase):
    CONFIG = lbl.load_config()

    def test_bracket_tags(self):
        self.assertEqual(lbl.issue_labels("[Web] Two form fields ...", self.CONFIG),
                         {"area/web"})
        self.assertEqual(lbl.issue_labels("[Server/Web] Report schedule ...", self.CONFIG),
                         {"area/server", "area/web"})
        self.assertEqual(lbl.issue_labels("[Low/Medium][Security] ai_jobs.json ...",
                                          self.CONFIG),
                         {"type/security", "prio/medium"})
        self.assertEqual(lbl.issue_labels("[High] No per-user data isolation", self.CONFIG),
                         {"prio/high"})
        self.assertEqual(lbl.issue_labels("[Low][UI/UX] German typo", self.CONFIG),
                         {"prio/low", "type/ux"})

    def test_leading_keyword(self):
        self.assertEqual(lbl.issue_labels("Bug; Upload not working", self.CONFIG),
                         {"type/bug"})
        self.assertEqual(lbl.issue_labels("Feat - Passkey/WebAuthn-Login", self.CONFIG),
                         {"type/feature"})
        self.assertEqual(lbl.issue_labels("GH Pages; Ugly", self.CONFIG),
                         {"area/website"})
        self.assertEqual(lbl.issue_labels("Android: Wunschliste als eigener Tab", self.CONFIG),
                         {"area/android"})
        self.assertEqual(lbl.issue_labels("Self-update blocks the event loop", self.CONFIG),
                         {"topic/self-update"})
        # Word boundary: "Bugs" or "Featured" is not the keyword.
        self.assertEqual(lbl.issue_labels("Featured polish list", self.CONFIG), set())

    def test_conventional_issue_title(self):
        self.assertEqual(lbl.issue_labels("fix(web): x", self.CONFIG),
                         {"type/bug", "area/web"})

    def test_plain_title_gets_nothing(self):
        self.assertEqual(lbl.issue_labels("Inspo Pic", self.CONFIG), set())
        # Brackets later in the title are content, not tags.
        self.assertEqual(lbl.issue_labels("Sticker form (WEB-STK-09) [web]", self.CONFIG),
                         set())

    def test_existing_prio_is_never_contradicted(self):
        exists = {"prio/low", "prio/high", "area/web"}
        self.assertEqual(lbl.issue_final_labels({"prio/low", "area/web"}, {"prio/high"},
                                                exists, True),
                         {"area/web"})
        self.assertEqual(lbl.pr_final_labels({"prio/low"}, {"prio/high"}, exists), set())

    def test_pr_inheriting_two_prios_keeps_the_higher(self):
        got = lbl.pr_labels("fix: x", ["v3/apps/web/src/App.tsx"], self.CONFIG,
                            {"prio/low", "prio/critical"})
        self.assertEqual({x for x in got if x.startswith("prio/")}, {"prio/critical"})

    def test_triage_until_prio_or_status(self):
        exists = {lbl.TRIAGE, "area/web", "prio/low"}
        self.assertEqual(lbl.issue_final_labels({"area/web"}, set(), exists, True),
                         {"area/web", lbl.TRIAGE})
        self.assertEqual(lbl.issue_final_labels({"area/web"}, {"prio/low"}, exists, True),
                         {"area/web"})
        # Closed issues are history, never triage.
        self.assertEqual(lbl.issue_final_labels(set(), set(), exists, False), set())
        # Triage label not created yet -> nothing grey.
        self.assertEqual(lbl.issue_final_labels(set(), set(), set(), True), set())


class TestSyncAndBackfill(unittest.TestCase):
    def test_alias_is_renamed_not_created(self):
        acts = lbl.plan_sync({"accessibility": {"color": "ededed", "description": ""}},
                             [{"name": "type/a11y", "color": "7057ff",
                               "aliases": ["accessibility"]}])
        self.assertEqual([a[:3] for a in acts], [("rename", "accessibility", "type/a11y")])

    def test_alias_stays_when_target_exists(self):
        acts = lbl.plan_sync({"bug": {"color": "d73a4a", "description": ""},
                              "type/bug": {"color": "d73a4a", "description": "d"}},
                             [{"name": "type/bug", "color": "d73a4a",
                               "description": "d", "aliases": ["bug"]}])
        self.assertEqual(acts, [])

    def test_unchanged_no_action_changed_update(self):
        have = {"prio/low": {"color": "0E8A16", "description": "d"}}
        want = [{"name": "prio/low", "color": "0e8a16", "description": "d"}]
        self.assertEqual(lbl.plan_sync(have, want), [])
        want[0]["description"] = "new"
        self.assertEqual(lbl.plan_sync(have, want)[0][0], "update")

    def test_backfill_separates_issues_and_prs_and_paginates(self):
        calls = []

        def fake_gh(*args):
            calls.append(args)
            return "12\ttrue\n7\tfalse\n"

        orig, lbl.gh = lbl.gh, fake_gh
        try:
            self.assertEqual(lbl.items(False), [(12, True), (7, False)])
            lbl.items(True)
        finally:
            lbl.gh = orig
        self.assertIn("--paginate", calls[0])
        self.assertIn("state=open", " ".join(calls[0]))
        self.assertIn("state=all", " ".join(calls[1]))


if __name__ == "__main__":
    unittest.main()
