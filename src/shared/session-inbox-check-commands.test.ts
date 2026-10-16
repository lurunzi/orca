import { describe, expect, it } from 'vitest'
import {
  NO_CHECK_TARGET,
  checkRun,
  checksIn,
  isTemporary,
  resolvePath
} from './session-inbox-check-commands'

describe('checksIn', () => {
  it('finds each check in a compound command, once', () => {
    const command =
      'cd mods/x && claude plugin test . > t.log 2>&1; echo "test exit $?"; npx -y -p typescript tsc --noEmit -p . > c.log 2>&1; echo "tsc exit $?"'
    expect(checksIn(command).map((c) => c.name)).toEqual(['plugin tests', 'tsc'])
  })

  it('ignores commands that only read, print, move files or install, and checks inside quotes', () => {
    for (const command of [
      'cat t.log | grep pass',
      'echo "run bun test later"',
      'git commit -m "Fix tsc errors and jest setup"',
      'git commit -m "fix tsc"',
      'until ! pgrep -x xcodebuild >/dev/null; do sleep 5; done',
      'if ! pgrep -x xcodebuild >/dev/null; then echo idle; fi',
      'for f in a b; do grep tsc $f; done',
      'kill $(pgrep -x xcodebuild)',
      'sed -n 1,20p vitest.config.ts',
      'wc -l tsc-output.log',
      'cp node_modules/vitest/vitest.mjs /tmp/x',
      'pnpm add -D vitest',
      'npm install --save-dev jest',
      'FOO=1 grep tsc notes.md',
      '# then run tsc\nls'
    ]) {
      expect(checksIn(command), command).toEqual([])
    }
  })

  it('reads comments and quotes as bash does', () => {
    const tests = [{ name: 'pnpm test', kind: 'tests' }]
    expect(checksIn("# don't run tsc yet\npnpm test 'a.test.ts'")).toEqual(tests)
    expect(checksIn('pnpm test # then tsc')).toEqual(tests)
    expect(checksIn('echo "a # b" && npx tsc')).toEqual([{ name: 'tsc', kind: 'types' }])
    expect(checkRun("# don't run tsc yet\npnpm test 'a.test.ts'", '/w', '/h')?.target).toEqual({
      paths: ['/w/a.test.ts'],
      filters: []
    })
  })

  it('names a package-manager script by its full script name', () => {
    expect(checksIn('npm run lint:css')).toEqual([{ name: 'lint:css', kind: 'lint' }])
    expect(checksIn('pnpm -C app run lint')).toEqual([{ name: 'lint', kind: 'lint' }])
    expect(checksIn('npm run test:unit -- a.test.ts')).toEqual([
      { name: 'npm test:unit', kind: 'tests' }
    ])
    expect(checksIn('yarn build:prod')).toEqual([{ name: 'yarn build:prod', kind: 'build' }])
    expect(checksIn('npm run typecheck:app')).toEqual([{ name: 'typecheck:app', kind: 'types' }])
    expect(checksIn('npm run test-e2e')).toEqual([{ name: 'npm test-e2e', kind: 'tests' }])
    expect(checksIn('pnpm lint:eslint')).toEqual([{ name: 'lint:eslint', kind: 'lint' }])
    expect(checksIn('pnpm typecheck:tsc:node')).toEqual([
      { name: 'typecheck:tsc:node', kind: 'types' }
    ])
  })

  it('names common runners by kind, behind a package manager’s options', () => {
    expect(checksIn('npm run build')).toEqual([{ name: 'npm build', kind: 'build' }])
    expect(checksIn('./scripts/validate.sh')).toEqual([{ name: 'validate.sh', kind: 'validate' }])
    expect(checksIn('./scripts/check.sh')).toEqual([{ name: 'check.sh', kind: 'all' }])
    expect(checksIn('npm --prefix /work/app test > t.log 2>&1')).toEqual([
      { name: 'npm test', kind: 'tests' }
    ])
  })

  it.each([
    ['pnpm vitest run src/a.test.ts', 'vitest', 'tests'],
    ['npx vitest run', 'vitest', 'tests'],
    [
      'node node_modules/vitest/vitest.mjs run -c config/vitest.config.ts a.test.ts',
      'vitest',
      'tests'
    ],
    ['ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run', 'vitest', 'tests'],
    ['node_modules/.bin/vitest run', 'vitest', 'tests'],
    ['npx tsc --noEmit', 'tsc', 'types'],
    ['node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json', 'tsc', 'types'],
    ['oxlint src/a.ts', 'oxlint', 'lint'],
    ['node node_modules/oxlint/bin/oxlint -c config/oxlint.json src/a.ts', 'oxlint', 'lint'],
    ['pnpm tc', 'typecheck', 'types'],
    ['pnpm typecheck', 'typecheck', 'types'],
    ['pnpm tc:node', 'typecheck:node', 'types'],
    ['pnpm lint', 'lint', 'lint']
  ])('reads `%s` as %s (%s)', (command, name, kind) => {
    expect(checksIn(command)).toEqual([{ name, kind }])
  })
})

describe('checkRun', () => {
  const run = (command: string) => checkRun(command, '/work/repo', '/home/me')
  const folder = (command: string) => run(command)?.folder

  it('runs in the shell’s folder, or the one the check names', () => {
    expect(folder('npm test')).toBe('/work/repo')
    expect(folder('claude plugin test mods/x')).toBe('/work/repo/mods/x')
    expect(folder('claude plugin test $HOME/x')).toBe('/home/me/x')
    expect(folder('npm --prefix ../app test')).toBe('/work/app')
    expect(folder('npx -y -p typescript tsc --noEmit -p ~/app/tsconfig.json')).toBe('/work/repo')
    // A TypeScript project selects a configuration without changing the shell folder.
    expect(
      folder('node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json')
    ).toBe('/work/repo')
  })

  it('is null when the command hides the folder', () => {
    expect(folder('claude plugin test $COPY')).toBe(null)
    expect(folder('npm --prefix "$(mktemp -d)" test')).toBe(null)
  })

  it('returns the piece of the command that ran the check, and null when none did', () => {
    expect(run('cd app && pnpm test > t.log 2>&1; echo done')?.command).toBe(
      'pnpm test > t.log 2>&1'
    )
    expect(run('git status')).toBe(null)
  })

  describe('after a leading cd', () => {
    it.each([
      ['cd app && pnpm test', '/work/repo/app'],
      ['cd app; pnpm test', '/work/repo/app'],
      ['cd app\npnpm test', '/work/repo/app'],
      ['cd app && cd sub && pnpm test', '/work/repo/app/sub'],
      ['cd app && rm -rf dist && pnpm test', '/work/repo/app'],
      ['cd .. && npm --prefix app test', '/work/app'],
      ['cd /srv/other && pnpm test', '/srv/other'],
      ['cd && pnpm test', '/home/me'],
      ['cd ~/x 2>/dev/null && pnpm test', '/home/me/x'],
      ['(cd app && make) && pnpm test', '/work/repo'],
      ['(cd app && pnpm test)', '/work/repo/app'],
      ['cd $DIR && pnpm test', null],
      ['cd - && pnpm test', null],
      ['cd $DIR && cd /srv/x && pnpm test', '/srv/x']
    ])('`%s` runs in %s', (command, expected) => {
      expect(folder(command)).toBe(expected)
    })
  })

  describe('target', () => {
    const none = { paths: [], filters: [] }
    const cases: [string, { paths?: string[]; filters?: string[] }][] = [
      ['npm test', none],
      ['vitest run', none],
      ['vitest run a.test.ts', { paths: ['/work/repo/a.test.ts'] }],
      [
        'npx vitest run src/a.test.ts src/b.test.ts --reporter dot',
        { paths: ['/work/repo/src/a.test.ts', '/work/repo/src/b.test.ts'] }
      ],
      ['vitest run -t "parses dates"', { filters: ['-t=parses dates'] }],
      ['vitest --testNamePattern=parses', { filters: ['--testNamePattern=parses'] }],
      ['jest --testPathPattern auth', { filters: ['--testPathPattern=auth'] }],
      ['pytest tests/ -k date -x -q', { paths: ['/work/repo/tests'], filters: ['-k=date'] }],
      ['pytest -v --tb short --color=yes', none],
      ['jest --bail --ci --coverage --silent', none],
      ['vitest --run --no-coverage', none],
      ['jest --runInBand --watchAll=false --forceExit', none],
      ['eslint --format stylish', none],
      ['bun test --timeout 5000', none],
      ['npm test -- --coverage', none],
      ['npm test -- a.test.ts > t.log 2>&1', { paths: ['/work/repo/a.test.ts'] }],
      ['npm run test:unit -- -t foo', { filters: ['-t=foo'] }],
      ['bun test src/a.test.ts', { paths: ['/work/repo/src/a.test.ts'] }],
      ['go test ./...', none],
      ['go test ./pkg/... -run TestX', { paths: ['/work/repo/pkg'], filters: ['-run=TestX'] }],
      ['cargo test parses_dates', { filters: ['parses_dates'] }],
      ['cargo test --manifest-path app/Cargo.toml foo', { filters: ['foo'] }],
      ['npm --prefix app test src/a.test.ts', { paths: ['/work/repo/app/src/a.test.ts'] }],
      ['claude plugin test mods/x', none],
      ['claude plugin test mods/x > t.log 2>&1', none],
      ['npx tsc --noEmit -p tsconfig.json', { filters: ['project=/work/repo/tsconfig.json'] }],
      ['tsc --noEmit --strict', { filters: ['--strict', 'project=/work/repo/tsconfig.json'] }],
      ['prettier --check .', none],
      ['prettier --check src', { filters: ['src'] }],
      [
        'eslint src/ --max-warnings 0',
        { paths: ['/work/repo/src'], filters: ['--max-warnings', '0'] }
      ],
      ['ruff check .', none],
      ['golangci-lint run ./...', none],
      ['vitest run /work/repo ./', none],
      ['vitest run ../other/a.test.ts', { paths: ['/work/other/a.test.ts'] }],
      ['vitest run ~/b.test.ts', { paths: ['/home/me/b.test.ts'] }],
      ['vitest run a.test.ts < in.txt', { paths: ['/work/repo/a.test.ts'] }],
      // A path that cannot be resolved is kept as written, so the run never clears a failure by mistake.
      ['vitest run $X/a.test.ts', { filters: ['$X/a.test.ts'] }],
      ['pnpm vitest run src/a.test.ts', { paths: ['/work/repo/src/a.test.ts'] }],
      [
        'node node_modules/vitest/vitest.mjs run src/a.test.ts',
        { paths: ['/work/repo/src/a.test.ts'] }
      ],
      ['node_modules/.bin/vitest run', none],
      [
        'node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json',
        { filters: ['project=/work/repo/config/tsconfig.node.json'] }
      ],
      ['oxlint src/a.ts', { paths: ['/work/repo/src/a.ts'] }],
      ['cd app && pnpm test src/a.test.ts', { paths: ['/work/repo/app/src/a.test.ts'] }]
    ]

    for (const [command, expected] of cases) {
      it(command, () => {
        expect(run(command)?.target).toEqual({ ...none, ...expected })
      })
    }

    it('is the whole suite when the run names no part of it', () => {
      expect(run('pnpm test')?.target).toEqual(NO_CHECK_TARGET)
      expect(NO_CHECK_TARGET).toEqual({ paths: [], filters: [] })
    })
  })

  describe('on Windows', () => {
    const win = (command: string, cwd = 'C:\\repo') => checkRun(command, cwd, 'C:\\Users\\me')

    it('reads drive, backslash and Git Bash folders', () => {
      expect(win('pnpm test')?.folder).toBe('C:/repo')
      expect(win('pnpm test', 'c:\\repo')?.folder).toBe('C:/repo')
      expect(win('cd "C:\\repo\\app" && npx vitest run')?.folder).toBe('C:/repo/app')
      expect(win("cd 'C:\\repo\\app\\' && npx vitest run")?.folder).toBe('C:/repo/app')
      expect(win('cd "app\\sub" && pnpm test')?.folder).toBe('C:/repo/app/sub')
      expect(win('cd ~/x && pnpm test')?.folder).toBe('C:/Users/me/x')
      expect(win('cd /c/repo/app && pnpm test')?.folder).toBe('C:/repo/app')
      expect(win('pnpm test', '/c/repo')?.folder).toBe('/c/repo')
      expect(win('npm --prefix "..\\lib" test')?.folder).toBe('C:/lib')
      expect(win('npx tsc --noEmit -p "config\\tsconfig.node.json"')?.folder).toBe('C:/repo')
    })

    it('resolves backslash targets against the folder', () => {
      expect(win('npx vitest run "src\\a.test.ts" C:/repo')?.target).toEqual({
        paths: ['C:/repo/src/a.test.ts'],
        filters: []
      })
      expect(win('.\\node_modules\\.bin\\vitest.cmd run src/a.test.ts')?.target).toEqual({
        paths: ['C:/repo/src/a.test.ts'],
        filters: []
      })
    })
  })

  describe('exitIsCheck', () => {
    it.each([
      ['pnpm test', true],
      ['cd app && pnpm test', true],
      ['echo start; pnpm test', true],
      ['pnpm test > t.log 2>&1 && tail -n 30 t.log', true],
      ['npx vitest run src/a.test.ts 2>&1', true],
      ['pnpm test | tail -30', false],
      ['pnpm test 2>&1 | tail -30', false],
      ['pnpm test; echo "exit $?"', false],
      ['pnpm test\necho done', false],
      ['pnpm test || true', false],
      ['pnpm test && echo ok || echo failed', false],
      ['pnpm lint && pnpm test', false],
      ['pnpm test && pnpm test', false],
      ['git diff --quiet || pnpm test', false],
      ['git diff --quiet || cat x | pnpm test', false],
      ['! pnpm test', false],
      ['pnpm test &', false],
      ['pnpm dev & pnpm test', false]
    ])('`%s` → %s', (command, expected) => {
      expect(run(command)?.exitIsCheck).toBe(expected)
    })
  })
})

describe('resolvePath', () => {
  it.each([
    ['/work/repo', '../app', '/work/app'],
    ['/work/repo', 'src/./a.ts', '/work/repo/src/a.ts'],
    ['/', '/work/./repo/', '/work/repo'],
    ['/', 'work', '/work'],
    ['/', '..', '/'],
    ['C:/', 'x', 'C:/x'],
    ['C:/repo', '..', 'C:/'],
    ['C:\\repo', 'app', 'C:/repo/app'],
    ['c:/repo', '..\\..\\x', 'C:/x'],
    ['C:/repo', '/c/x', 'C:/x'],
    ['/repo', '/c/x', '/c/x'],
    ['/work/repo', 'D:\\x', 'D:/x'],
    ['\\\\wsl.localhost\\Ubuntu\\home', 'repo', '//wsl.localhost/Ubuntu/home/repo']
  ])('%s + %s → %s', (from, path, expected) => {
    expect(resolvePath(from, path)).toBe(expected)
  })
})

describe('isTemporary', () => {
  it.each([
    ['/tmp/copy', true],
    ['/private/var/folders/ab/T/copy', true],
    ['/var/tmp', true],
    ['C:/Users/me/AppData/Local/Temp/copy', true],
    ['c:\\users\\me\\appdata\\local\\temp', true],
    ['C:/Windows/Temp/x', true],
    ['/c/Users/me/AppData/Local/Temp/x', true],
    ['/work/tmp', false],
    ['/tmpfiles', false],
    ['C:/Users/me/repo', false],
    ['C:/Temp', false]
  ])('%s → %s', (folder, expected) => {
    expect(isTemporary(folder)).toBe(expected)
  })
})
