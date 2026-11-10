# ts-shell-token-splitter

Splits a shell command string into argument tokens following POSIX quoting and escape rules.

```js
import { tokenize } from 'ts-shell-token-splitter';

const argv = tokenize(`git commit -m 'fix: handle "empty" args' -- src/`);
// => ['git', 'commit', '-m', 'fix: handle "empty" args', '--', 'src/']
```

## Why this exists

Most "split a command line" helpers either shell out to a real shell (slow, and a
surprising amount of surface area to expose) or do a naive `split(' ')` that falls
apart the moment a path contains a space. This library is a small, dependency-free
tokenizer that implements the quoting and escaping rules directly, so it can run
synchronously in any JavaScript environment without spawning anything.

The trade-off is scope. It handles word splitting only: single quotes, double
quotes, backslash escapes, `$'...'` ANSI-C quoting, and `#` comments. It does
**not** expand variables, run command substitution, glob, or interpret pipes and
redirections. If you need those, you want a shell, not a tokenizer.

## API

- `tokenize(input: string): string[]` — throws `ShellSyntaxError` on malformed input.
- `tokenizeWithErrors(input: string): { tokens: string[], error: ShellSyntaxError | null }` —
  never throws for syntax errors; returns an empty token list alongside the error.
- `ShellSyntaxError` — `Error` subclass with `name === 'ShellSyntaxError'` and an
  `index` property pointing at the offending character.

## Edge cases worth knowing

- A newline is treated as ordinary whitespace, not a command separator. `'a\nb'`
  becomes `['a', 'b']`. This matches how most callers hand a multi-line string to a
  subprocess helper.
- A `#` only starts a comment when it is at the start of a word. `echo a#b` keeps
  the `#`; `echo hi # note` drops the comment.
- Inside double quotes, a backslash only escapes `$`, `` ` ``, `"`, `\`, and
  newline. Before anything else it stays literal, so `"a\nb"` is the four-character
  string `a\nb`, not `a` followed by a newline.
- `$'...'` decodes `\n`, `\t`, `\xHH`, `\uHHHH`, `\UHHHHHHHH`, and octal escapes.
  Unknown escapes keep the backslash, matching bash.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

