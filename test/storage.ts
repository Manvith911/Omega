import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HistoryStore } from '../src/main/history-store'
import { isProbablyUrl, prettyUrl, protocolKind, searchUrlFor, toNavigationUrl } from '../src/shared/url'

let failures = 0
function check(condition: boolean, label: string, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'omega-verify-'))

console.log('\n== URL normalization ==')
const cases: [string, string][] = [
  ['github.com', 'https://github.com'],
  ['developer.mozilla.org/en-US/docs', 'https://developer.mozilla.org/en-US/docs'],
  ['localhost:3000', 'http://localhost:3000'],
  ['127.0.0.1:8080/status', 'http://127.0.0.1:8080/status'],
  ['omega://newtab', 'omega://newtab'],
  ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
]
for (const [input, expected] of cases) {
  const actual = toNavigationUrl(input, 'duckduckgo')
  check(actual === expected, `${input} -> ${expected}`, actual)
}
check(toNavigationUrl('how do i center a div', 'duckduckgo').startsWith('https://duckduckgo.com/?q=how'), 'spaces become a search')
check(toNavigationUrl('  ', 'duckduckgo') === 'omega://newtab', 'empty input opens the new tab page')
check(isProbablyUrl('foo') === false, 'bare word is not a URL')
check(isProbablyUrl('foo.bar') === true, 'dotted word is a URL')
check(searchUrlFor('a b', 'google') === 'https://www.google.com/search?q=a%20b', 'search URL is encoded')
check(prettyUrl('https://github.com/') === 'github.com', 'prettyUrl strips scheme and trailing slash', prettyUrl('https://github.com/'))
check(prettyUrl('https://a.test/x?y=1') === 'a.test/x?y=1', 'prettyUrl keeps path and query')
check(protocolKind('https://x.test') === 'https', 'protocolKind https')
check(protocolKind('http://x.test') === 'http', 'protocolKind http')
check(protocolKind('omega://newtab') === 'local', 'protocolKind local')

console.log('\n== HistoryStore ==')
const h = new HistoryStore(dir)

h.record('https://github.com/anthropics/claude-code', 'Claude Code')
h.record('https://github.com/anthropics/claude-code', 'Claude Code')
h.record('https://github.com/anthropics/claude-code', 'Claude Code')
h.record('https://news.ycombinator.com/', 'Hacker News')
h.record('https://developer.mozilla.org/en-US/docs/Web/API', 'MDN Web Docs')
h.record('about:blank', 'must be ignored')
h.record('file:///C:/tmp/x.html', 'must be ignored')

const recent = h.recent(20)
check(recent.length === 3, 'non-http(s) URLs are not recorded', `got ${recent.length}`)

const gh = recent.find((r) => r.url.includes('github'))
check(gh?.visitCount === 3, 'visit_count increments on conflict', `got ${gh?.visitCount}`)

h.touchTitle('https://github.com/anthropics/claude-code', 'Claude Code CLI')
const after = h.recent(20).find((r) => r.url.includes('github'))
check(after?.visitCount === 3, 'touchTitle does not inflate visit_count', `got ${after?.visitCount}`)
check(after?.title === 'Claude Code CLI', 'touchTitle updates the title', after?.title ?? '')

// FTS5 tokenises on word boundaries.
check(h.suggest('moz', 5).some((s) => s.url.includes('mozilla')), 'FTS prefix match: "moz" -> mozilla.org')
check(h.suggest('hacker', 5).some((s) => s.url.includes('ycombinator')), 'FTS match on title: "hacker"')
// "hub" is not a token prefix of "github", so only the LIKE pass can find it.
check(h.suggest('hub', 5).some((s) => s.url.includes('github')), 'substring match: "hub" -> github.com')
check(h.suggest('zzzznotfound', 5).length === 0, 'no matches returns an empty list')
check(h.suggest('"', 5).length === 0, 'malformed FTS input does not throw')

const top = h.topSites(5)
check(top[0]?.url.includes('github'), 'top sites ranks by visit count', top[0]?.url ?? '')

h.saveSession(['https://a.test/', 'https://b.test/', 'https://c.test/'])
check(
  JSON.stringify(h.loadSession()) === JSON.stringify(['https://a.test/', 'https://b.test/', 'https://c.test/']),
  'session round trips',
  JSON.stringify(h.loadSession()),
)

h.clear()
check(h.recent(20).length === 0, 'clear() empties history')
check(h.suggest('github', 5).length === 0, 'clear() also empties the FTS index')
check(h.loadSession() !== null, 'clear() leaves sessions intact')

h.close()

// Reopening must not throw and must reuse the existing schema.
const h2 = new HistoryStore(dir)
h2.record('https://reopen.test/', 'Reopened')
check(h2.recent(5).length === 1, 'reopening an existing database works')
h2.close()

rmSync(dir, { recursive: true, force: true })

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
