import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, tokenizeWithErrors, ShellSyntaxError } from '../src/index.js';

test('empty input yields no tokens', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   \t\n  '), []);
});

test('plain words split on whitespace', () => {
  assert.deepEqual(tokenize('ls -la /tmp'), ['ls', '-la', '/tmp']);
  assert.deepEqual(tokenize('a\tb\nc'), ['a', 'b', 'c']);
});

test('single quotes preserve everything literally', () => {
  assert.deepEqual(tokenize("echo 'hello world'"), ['echo', 'hello world']);
  assert.deepEqual(tokenize("echo 'a\\b'"), ['echo', 'a\\b']);
});

test('double quotes allow escapes only before special chars', () => {
  assert.deepEqual(tokenize('echo "a b"'), ['echo', 'a b']);
  assert.deepEqual(tokenize('echo "a\\"b"'), ['echo', 'a"b']);
  // Backslash before an ordinary character stays literal.
  assert.deepEqual(tokenize('echo "a\\nb"'), ['echo', 'a\\nb']);
});

test('backslash escapes outside quotes', () => {
  assert.deepEqual(tokenize('a\\ b'), ['a b']);
  assert.deepEqual(tokenize('a\\nb'), ['anb']);
});

test('adjacent quoted and bare fragments join into one token', () => {
  assert.deepEqual(tokenize('a"b c"d'), ['ab cd']);
  assert.deepEqual(tokenize("'x'\"y\"z"), ['xyz']);
});

test('ANSI-C quoting decodes common escapes', () => {
  assert.deepEqual(tokenize("$'a\\nb'"), ['a\nb']);
  assert.deepEqual(tokenize("$'\\x41\\x42'"), ['AB']);
  assert.deepEqual(tokenize("$'\\101\\102'"), ['AB']);
  assert.deepEqual(tokenize("$'it\\'s'"), ["it's"]);
});

test('comments starting a word are stripped to end of line', () => {
  assert.deepEqual(tokenize('echo hi # trailing comment'), ['echo', 'hi']);
  assert.deepEqual(tokenize('# whole line\necho hi'), ['echo', 'hi']);
  // A `#` inside a word is not a comment.
  assert.deepEqual(tokenize('echo a#b'), ['echo', 'a#b']);
});

test('unterminated quotes raise ShellSyntaxError with an index', () => {
  assert.throws(() => tokenize("echo 'unterminated"), (err) => {
    assert.ok(err instanceof ShellSyntaxError);
    assert.equal(err.index, 5);
    return true;
  });
  assert.throws(() => tokenize('echo "unterminated'), (err) => {
    assert.ok(err instanceof ShellSyntaxError);
    return true;
  });
});

test('trailing backslash is an error', () => {
  assert.throws(() => tokenize('echo \\'), (err) => {
    assert.ok(err instanceof ShellSyntaxError);
    return true;
  });
});

test('tokenizeWithErrors reports without throwing', () => {
  const ok = tokenizeWithErrors('a b');
  assert.deepEqual(ok.tokens, ['a', 'b']);
  assert.equal(ok.error, null);

  const bad = tokenizeWithErrors("a 'b");
  assert.deepEqual(bad.tokens, []);
  assert.ok(bad.error instanceof ShellSyntaxError);
});

test('non-string input is rejected', () => {
  assert.throws(() => tokenize(null), TypeError);
  assert.throws(() => tokenize(42), TypeError);
});
