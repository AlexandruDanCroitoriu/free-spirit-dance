"""Synthetic active-target safety tests; no network or private data."""
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import production_target as target

ACTIVE = 'a8506137-f504-4719-bd21-d52cd0c57462'
RESTORED = 'fdfa7d08-1c34-48fb-a874-8f2a6c7d4022'
DATABASES = [{'name':'original','uuid':target.ORIGINAL_ID}, {'name':'fsd-backup-'+ACTIVE,'uuid':RESTORED}]
STATUS = {'available':True,'active':ACTIVE,'generation':30,'workingReady':True,'readOnly':False,'maintenance':False,'job':False}


class TargetTests(unittest.TestCase):
    def test_original_and_promoted_database_are_distinct(self):
        restored = target.select_target(STATUS, DATABASES)
        self.assertEqual(restored['database_id'], RESTORED)
        original = target.select_target({**STATUS,'active':'production'}, DATABASES)
        self.assertEqual(original['database_id'], target.ORIGINAL_ID)

    def test_preview_busy_unready_missing_and_ambiguous_targets_stop(self):
        for changes in [{'readOnly':True},{'maintenance':True},{'job':True},{'workingReady':False},
                        {'active':None},{'available':False},{'generation':None}]:
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                target.select_target({**STATUS,**changes}, DATABASES)
        for databases in [DATABASES[:1], DATABASES + [DATABASES[1]]]:
            with self.assertRaises(RuntimeError):
                target.select_target(STATUS, databases)

    def test_resolution_race_stops(self):
        with patch.object(target, 'bridge_status', side_effect=[STATUS,{**STATUS,'generation':31}]), patch.object(target,'list_databases',return_value=DATABASES):
            with self.assertRaisesRegex(RuntimeError,'changed'):
                target.resolve(Path('/synthetic'))

    def test_unavailable_bridge_never_falls_back(self):
        with patch.object(target,'bridge_status',side_effect=RuntimeError('unavailable')), patch.object(target,'list_databases') as listing:
            with self.assertRaises(RuntimeError):
                target.resolve(Path('/synthetic'))
            listing.assert_not_called()

    def test_recheck_rejects_switches_and_maintenance(self):
        resolved = target.select_target(STATUS,DATABASES)
        for changes in [{'active':'production'},{'generation':31},{'readOnly':True},{'maintenance':True},{'job':True},{'workingReady':False}]:
            with patch.object(target,'bridge_status',return_value={**STATUS,**changes}), self.assertRaises(RuntimeError):
                target.verify(Path('/synthetic'),resolved)

    def test_ephemeral_config_points_only_to_active_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {'d1_databases':[{'binding':'PRODUCTION_DB','database_id':target.ORIGINAL_ID,'remote':True}]}
            config = root/'wrangler.local.json';config.write_text(json.dumps(source));original=config.read_bytes()
            with target.configuration(root,target.select_target(STATUS,DATABASES)) as generated:
                binding=json.loads(generated.read_text())['d1_databases'][0]
                self.assertEqual(binding['database_id'],RESTORED)
                self.assertEqual(binding['binding'],'PRODUCTION_DB')
                self.assertEqual(binding['migrations_dir'],str(root/'migrations'))
                self.assertEqual(generated.stat().st_mode & 0o777,0o600)
            self.assertFalse(generated.exists())
            self.assertEqual(config.read_bytes(),original)

    def test_migration_runner_cannot_write_without_active_resolution(self):
        spec=importlib.util.spec_from_file_location('migration_target_test',Path(__file__).with_name('migrate-databases.py'))
        migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
        with patch.object(migration.subprocess,'run') as command:
            with self.assertRaisesRegex(RuntimeError,'not been resolved'):
                migration.run(('PRODUCTION_DB',True),['migrations','apply'])
            command.assert_not_called()
        with ExitStack() as stack:
            stack.enter_context(patch.object(migration,'ACTIVE_TARGET',target.select_target(STATUS,DATABASES)))
            stack.enter_context(patch.object(migration,'REMOTE_CONFIG',Path('/private/active.json')))
            stack.enter_context(patch.object(target,'verify',side_effect=RuntimeError('active changed')))
            command=stack.enter_context(patch.object(migration.subprocess,'run'))
            with self.assertRaisesRegex(RuntimeError,'active changed'):
                migration.run(('PRODUCTION_DB',True),['migrations','apply'])
            command.assert_not_called()
            self.assertIn('/private/active.json',migration.command(('PRODUCTION_DB',True),['migrations','apply']))
            self.assertNotIn('/private/active.json',migration.command(('CATALOG_DB',False),['migrations','apply']))


if __name__=='__main__':
    unittest.main()
