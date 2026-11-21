'use strict';
// Publishes what the Learning Studio saved: git add (characters/, library/ and director/ (saved lab examples) ONLY) -> commit -> pull --rebase -> push.
// Never `git add .` and never touches the baked files, so a half-finished edit elsewhere is never swept into a commit.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PATHS = ['characters', 'library', 'director'];

function git(root, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, maxBuffer: 16e6 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }));
  });
}

// publish(root, message, { push }) -> { ok, committed, pushed, error? }
async function publish(root, message, opts) {
  const push = !opts || opts.push !== false;
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) return { ok: false, committed: false, pushed: false, error: 'not a git repository' };
  const paths = PATHS.filter((p) => fs.existsSync(path.join(root, p)));
  if (!paths.length) return { ok: true, committed: false, pushed: false };
  const add = await git(root, ['add', '--', ...paths]);
  if (!add.ok) return { ok: false, committed: false, pushed: false, error: add.err.trim() };
  const staged = await git(root, ['diff', '--cached', '--quiet', '--', ...paths]);
  if (staged.ok) return { ok: true, committed: false, pushed: false };            // nothing new
  const commit = await git(root, ['commit', '-m', message || 'Learning Studio: update library', '--', ...paths]);
  if (!commit.ok) return { ok: false, committed: false, pushed: false, error: (commit.err || commit.out).trim() };
  if (!push) return { ok: true, committed: true, pushed: false };
  const pull = await git(root, ['pull', '--rebase', '--autostash']);
  if (!pull.ok) return { ok: false, committed: true, pushed: false, error: pull.err.trim() };
  const pushed = await git(root, ['push']);
  if (!pushed.ok) return { ok: false, committed: true, pushed: false, error: pushed.err.trim() };
  return { ok: true, committed: true, pushed: true };
}

module.exports = { publish, PATHS };
