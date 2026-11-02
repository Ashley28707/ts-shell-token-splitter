// Shell token splitter: POSIX shell quoting and escape rules.
//
// The goal is to reproduce the word-splitting half of what a POSIX shell does
// before it runs a command: turn a single string into an array of argument
// tokens, honouring single quotes, double quotes, backslash escapes, and the
// `$'...'` ANSI-C quoting form. It intentionally does NOT do variable
// expansion, command substitution, globbing, or redirection parsing -- those
// are separate concerns and mixing them in makes the tokenizer impossible to
// reason about.
//
// The one deliberate simplification: this tokenizer never treats a newline as
// a command separator. A newline inside an unquoted run is ordinary whitespace,
// exactly like a space or a tab. That matches `xargs`-style splitting and is
// what most callers actually want when they hand a command string to a
// subprocess helper.

export class ShellSyntaxError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'ShellSyntaxError';
    this.index = index;
  }
}

const isWhitespace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

// Decode the escapes that are legal inside a `$'...'` ANSI-C quoted string.
// Returns the decoded character and the index just past the escape sequence.
function decodeAnsiEscape(input, i) {
  // i points at the backslash.
  const ch = input[i + 1];
  if (ch === undefined) {
    throw new ShellSyntaxError('unterminated escape in $\'...\' string', i);
  }
  switch (ch) {
    case 'a': return ['\x07', i + 2];
    case 'b': return ['\b', i + 2];
    case 'e': return ['\x1b', i + 2];
    case 'E': return ['\x1b', i + 2];
    case 'f': return ['\f', i + 2];
    case 'n': return ['\n', i + 2];
    case 'r': return ['\r', i + 2];
    case 't': return ['\t', i + 2];
    case 'v': return ['\v', i + 2];
    case '\\': return ['\\', i + 2];
    case "'": return ["'", i + 2];
    case '"': return ['"', i + 2];
    case '?': return ['?', i + 2];
    case '0': case '1': case '2': case '3':
    case '4': case '5': case '6': case '7': {
      // Octal: up to three digits.
      let j = i + 1;
      let digits = '';
      while (j < input.length && digits.length < 3 && input[j] >= '0' && input[j] <= '7') {
        digits += input[j];
        j += 1;
      }
      if (digits.length === 0) {
        throw new ShellSyntaxError('empty octal escape in $\'...\' string', i);
      }
      const code = parseInt(digits, 8);
      return [String.fromCharCode(code), j];
    }
    case 'x': {
      let j = i + 2;
      let digits = '';
      while (j < input.length && digits.length < 2 && /[0-9a-fA-F]/.test(input[j])) {
        digits += input[j];
        j += 1;
      }
      if (digits.length === 0) {
        throw new ShellSyntaxError('empty hex escape in $\'...\' string', i);
      }
      return [String.fromCharCode(parseInt(digits, 16)), j];
    }
    case 'u': {
      let j = i + 2;
      let digits = '';
      while (j < input.length && digits.length < 4 && /[0-9a-fA-F]/.test(input[j])) {
        digits += input[j];
        j += 1;
      }
      if (digits.length === 0) {
        throw new ShellSyntaxError('empty unicode escape in $\'...\' string', i);
      }
      return [String.fromCodePoint(parseInt(digits, 16)), j];
    }
    case 'U': {
      let j = i + 2;
      let digits = '';
      while (j < input.length && digits.length < 8 && /[0-9a-fA-F]/.test(input[j])) {
        digits += input[j];
        j += 1;
      }
      if (digits.length === 0) {
        throw new ShellSyntaxError('empty unicode escape in $\'...\' string', i);
      }
      return [String.fromCodePoint(parseInt(digits, 16)), j];
    }
    default:
      // POSIX leaves unknown escapes implementation-defined; bash keeps the
      // backslash. We keep it too so round-tripping is lossless.
      return ['\\' + ch, i + 2];
  }
}

function readAnsiCString(input, start) {
  // `start` points at the opening single quote (after `$`).
  let out = '';
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'") {
      return [out, i + 1];
    }
    if (ch === '\\') {
      const [decoded, next] = decodeAnsiEscape(input, i);
      out += decoded;
      i = next;
      continue;
    }
    out += ch;
    i += 1;
  }
  throw new ShellSyntaxError('unterminated $\'...\' string', start);
}

function readSingleQuoted(input, start) {
  // `start` points at the opening quote. Inside single quotes everything is
  // literal; the only way out is a closing quote.
  const end = input.indexOf("'", start + 1);
  if (end === -1) {
    throw new ShellSyntaxError('unterminated single-quoted string', start);
  }
  return [input.slice(start + 1, end), end + 1];
}

function readDoubleQuoted(input, start) {
  // `start` points at the opening quote. Backslash is special only before
  // `$`, backtick, `"`, `\`, or newline; before anything else it is literal.
  let out = '';
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"') {
      return [out, i + 1];
    }
    if (ch === '\\') {
      const next = input[i + 1];
      if (next === undefined) {
        throw new ShellSyntaxError('unterminated escape in double-quoted string', i);
      }
      if (next === '$' || next === '`' || next === '"' || next === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (next === '\n') {
        // Line continuation: the backslash-newline pair vanishes.
        i += 2;
        continue;
      }
      out += '\\';
      out += next;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  throw new ShellSyntaxError('unterminated double-quoted string', start);
}

function readBareWord(input, start) {
  // A bare word runs until unquoted whitespace. Quotes and backslashes inside
  // it are still processed, so `a"b c"d` is a single token `ab cd`.
  let out = '';
  let i = start;
  while (i < input.length) {
    const ch = input[i];
    if (isWhitespace(ch)) {
      break;
    }
    if (ch === '\\') {
      const next = input[i + 1];
      if (next === undefined) {
        throw new ShellSyntaxError('trailing backslash', i);
      }
      if (next === '\n') {
        // Line continuation.
        i += 2;
        continue;
      }
      out += next;
      i += 2;
      continue;
    }
    if (ch === "'") {
      const [piece, next] = readSingleQuoted(input, i);
      out += piece;
      i = next;
      continue;
    }
    if (ch === '"') {
      const [piece, next] = readDoubleQuoted(input, i);
      out += piece;
      i = next;
      continue;
    }
    if (ch === '$' && input[i + 1] === "'") {
      const [piece, next] = readAnsiCString(input, i + 1);
      out += piece;
      i = next;
      continue;
    }
    out += ch;
    i += 1;
  }
  return [out, i];
}

// Top-level tokenizer. Throws ShellSyntaxError on malformed input.
export function tokenize(input) {
  if (typeof input !== 'string') {
    throw new TypeError('tokenize() expects a string');
  }
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    if (isWhitespace(input[i])) {
      i += 1;
      continue;
    }
    // A `#` at the start of a word begins a comment that runs to end of line.
    // This mirrors interactive-shell behaviour and is the common expectation
    // when a user pastes a multi-line snippet.
    if (input[i] === '#' && (i === 0 || isWhitespace(input[i - 1]))) {
      while (i < input.length && input[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    const [word, next] = readBareWord(input, i);
    tokens.push(word);
    i = next;
  }
  return tokens;
}

// Non-throwing variant. Returns `{ tokens, error }` where `error` is null on
// success. Useful when the caller wants to surface a diagnostic rather than
// crash on malformed input.
export function tokenizeWithErrors(input) {
  try {
    return { tokens: tokenize(input), error: null };
  } catch (err) {
    if (err instanceof ShellSyntaxError) {
      return { tokens: [], error: err };
    }
    throw err;
  }
}
