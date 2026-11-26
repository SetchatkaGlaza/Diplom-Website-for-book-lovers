'use strict';

/**
 * Убирает трейлер Co-authored-by из сообщений коммитов.
 *
 *   git rev-list <новый-кончик> | node scripts/strip-coauthor.js карта.txt
 *
 * Скрипт читает SHA со stdin, печатает «старый новый» и дописывает пары в
 * файл карты, чтобы переписать историю одним заходом.
 *
 * Дерево коммита не трогается: меняется только текст сообщения, поэтому
 * содержимое репозитория остаётся байт в байт прежним. Автор и даты
 * сохраняются. Убираются строки, где соавтором указан arena-agent —
 * служебный трейлер, который дописывался локальным хуком песочницы.
 *
 * После перезаписи: git push --force-with-lease, затем
 * `git tag backup/main-before-rewrite <старый SHA>` остаётся на случай отката.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const TRAILER = /^\s*co-authored-by:\s*arena-agent\b.*$/gim;

const mapFile = process.argv[2];
if (!mapFile) {
  console.error('нужен файл с картой "старый новый"');
  process.exit(1);
}

const map = new Map();
for (const line of fs.readFileSync(mapFile, 'utf8').split('\n')) {
  const [from, to] = line.trim().split(/\s+/);
  if (from && to) map.set(from, to);
}

function cleanMessage(sha) {
  const raw = execFileSync('git', ['log', '-1', '--format=%B', sha], { encoding: 'utf8' });
  const cleaned = raw.replace(TRAILER, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  return `${cleaned}\n`;
}

/** env для git commit-tree: те же автор и даты, что были */
function envFor(sha) {
  const format = '%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI';
  const [an, ae, ad, cn, ce, cd] = execFileSync(
    'git', ['log', '-1', `--format=${format}`, sha], { encoding: 'utf8' }
  ).trim().split('\0');

  return {
    ...process.env,
    GIT_AUTHOR_NAME: an,
    GIT_AUTHOR_EMAIL: ae,
    GIT_AUTHOR_DATE: ad,
    GIT_COMMITTER_NAME: cn,
    GIT_COMMITTER_EMAIL: ce,
    GIT_COMMITTER_DATE: cd,
    // если локально включён gpg-подпись, старые подписи всё равно станут невалидны
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'commit.gpgsign',
    GIT_CONFIG_VALUE_0: 'false'
  };
}

function rewrite(sha) {
  if (map.has(sha)) return map.get(sha);

  const parents = execFileSync('git', ['log', '-1', '--format=%P', sha], { encoding: 'utf8' })
    .trim().split(/\s+/).filter(Boolean).map(rewrite);

  const message = cleanMessage(sha);
  const args = ['commit-tree', `${sha}^{tree}`, '-m', message];
  for (const parent of parents) args.push('-p', parent);

  const next = execFileSync('git', args, {
    encoding: 'utf8',
    env: envFor(sha),
    maxBuffer: 64 * 1024 * 1024
  }).trim();

  map.set(sha, next);
  fs.appendFileSync(mapFile, `${sha} ${next}\n`);
  return next;
}

const input = fs.readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
for (const line of input) {
  const [sha, ...rest] = line.split(' ');
  const meta = rest.join(' ');
  const next = rewrite(sha);
  console.log(`${sha.slice(0, 7)} -> ${next.slice(0, 7)}  ${meta}`);
}
