import { Tiktoken } from './vendor/encoder.js';
import ranks from './vendor/o200k-base.js';

let encoder;
/** o200k_base BPE provides local estimates for models without published vocabularies, not provider billing figures. */
export function countTokens(text) {
  encoder ||= new Tiktoken(ranks);
  // Treat special-token-like page text as ordinary text so tokenization cannot throw or inject control tokens.
  return encoder.encode(text, [], []).length;
}
