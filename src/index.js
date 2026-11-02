// Public entry point for ts-shell-token-splitter.
//
// The library is split into `core.js` (the tokenizer) and this file (the
// re-exports). Keeping the re-export layer thin means consumers can import
// from the package root without pulling in anything they did not ask for, and
// it gives us a single place to document the public surface.

export { tokenize, tokenizeWithErrors, ShellSyntaxError } from './core.js';
