import assert from "node:assert/strict";
import test from "node:test";

import { answerFromEnvelope } from "../plugins/grok-build/scripts/grok-bridge.mjs";

// `--output-format plain` concatenates commentary turns and the final answer with
// no separator, so the answer arrives glued to the last sentence of the
// narration. This is the shape of a real observed payload, reproduced
// synthetically: a genuine review whose verdict was unreadable because it was
// not on a line of its own.
const GLUED_PLAIN_STREAM =
  "I'll review only those three files, starting with the branch diffs so the " +
  "verdict is based on the actual changes.I have the delta. Next I'll read the " +
  "surrounding functions and tests for holes, not just the patched lines." +
  "VERDICT: REVISE\n\nThe glue refusal is the right call, and splitting " +
  "resolution tests off the live install is the right call.\n";

// What `--output-format json` emits: one object, the answer under `.text`, the
// reasoning kept separately under `.thought`.
const ENVELOPE = JSON.stringify({
  text: "VERDICT: REVISE\n\nThe glue refusal is the right call.\n",
  stopReason: "end_turn",
  sessionId: "01a0b35a-20fc-7a41-9419-aaf9e4888da4",
  thought: "The user wants a review of three files. I should read the diffs first.",
  usage: { input_tokens: 18732, output_tokens: 18 }
});

test("the answer is the envelope's text, and nothing else", () => {
  const result = answerFromEnvelope(ENVELOPE);
  assert.equal(result.ok, true);
  assert.equal(result.error, "");
  assert.equal(result.text, "VERDICT: REVISE\n\nThe glue refusal is the right call.\n");
  // The answer starts on its own line, which is what a consumer needs.
  assert.equal(result.text.split("\n")[0], "VERDICT: REVISE");
});

test("reasoning never leaks into the answer", () => {
  const { text } = answerFromEnvelope(ENVELOPE);
  assert.ok(!text.includes("The user wants a review"), "thought must stay out of text");
});

test("a glued plain stream is refused, not searched", () => {
  const result = answerFromEnvelope(GLUED_PLAIN_STREAM);
  assert.equal(result.ok, false);
  assert.equal(result.text, "");
  assert.match(result.error, /not JSON/);
});

test("a JSON example inside a plain stream is not brace-sliced into success", () => {
  // `parseStructuredOutput` slices from the first `{` to the last `}`, so this
  // body parses as success there and still returns the whole stream as
  // rawOutput. Here it must simply fail.
  const withExample =
    'Narration about the contract.Here is the shape:\n' +
    '```json\n{"text":"VERDICT: APPROVED"}\n```\nVERDICT: REVISE\n';
  const result = answerFromEnvelope(withExample);
  assert.equal(result.ok, false);
  assert.equal(result.text, "");
});

test("every unusable shape fails closed with an empty answer", () => {
  const cases = {
    "empty string": "",
    "whitespace only": "   \n\t ",
    "not a string": undefined,
    "null": null,
    "truncated json": '{"text": "VERDICT: REVISE"',
    "json array": '[{"text":"VERDICT: REVISE"}]',
    "json string": '"VERDICT: REVISE"',
    "json null": "null",
    "no text field": '{"stopReason":"end_turn","sessionId":"x"}',
    "text is not a string": '{"text":["VERDICT: REVISE"]}',
    "text is empty": '{"text":""}',
    "text is whitespace": '{"text":"  \\n "}'
  };
  for (const [name, input] of Object.entries(cases)) {
    const result = answerFromEnvelope(input);
    assert.equal(result.ok, false, `${name} must not be ok`);
    assert.equal(result.text, "", `${name} must yield no answer`);
    assert.ok(result.error.length > 0, `${name} must say why`);
  }
});

test("a legitimate answer that merely mentions JSON still parses", () => {
  const envelope = JSON.stringify({
    text: 'VERDICT: APPROVED\n\nThe payload `{"a":1}` is handled correctly.\n',
    stopReason: "end_turn"
  });
  const result = answerFromEnvelope(envelope);
  assert.equal(result.ok, true);
  assert.match(result.text, /^VERDICT: APPROVED\n/);
});
