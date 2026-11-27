// Test-only: reuse the existing synthetic, authorization-scoped readers.
// No provider, HTTP, live DB, browser mount or credentials are introduced.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createOfflineConnectedReview } from '../../api/_lib/ai/offline-connected-review.js';

const context = {};
vm.runInNewContext(
  await readFile('novelight-ai-review-result.js', 'utf8'),
  context
);
const ui = context.NovelightAiReviewResult;

function testContainer() {
  const doc = {
    createElement(tag) {
      return {
        tag,
        ownerDocument: doc,
        textContent: '',
        childNodes: [],
        appendChild(node) {
          this.childNodes.push(node);
        },
        replaceChildren() {
          this.childNodes = [];
        }
      };
    }
  };
  return doc.createElement('div');
}

function textOf(node) {
  return [node.textContent, ...node.childNodes.map(textOf)].join('\n');
}

// Convert only the existing fixture's numeric IDs to the string form
// supplied by HTML inputs. All other input is passed to the real projector.
function inputSelection(selection) {
  const result = { ...selection };
  if (typeof result.novelId === 'number') {
    result.novelId = String(result.novelId);
  }
  if (Array.isArray(result.episodeIds)) {
    result.episodeIds = result.episodeIds.map(String);
  }
  return result;
}

export async function prepareScreenFlow(
  adapter,
  reader,
  feature,
  selection,
  auth
) {
  const root = testContainer();
  let current = true;
  const controller = ui.createScreenController(root, [feature], () => current);
  const input = inputSelection(selection);
  const begin = () => controller.begin(feature, input);
  const pending = begin();
  assert.ok(pending, feature + ': UI rejected fixture input');
  const api = createOfflineConnectedReview({ [adapter]: reader });
  // Simulate the JSON boundary between browser and server, rather than
  // sharing VM-realm prototypes with the Node fixture.
  const request = JSON.parse(JSON.stringify(pending.request));
  const prepared = await api.prepare(request, auth);

  return {
    ...prepared,
    async review(candidate, expectedText) {
      const envelope = await api.review(request, auth, candidate);
      assert.equal(envelope.featureKey, feature);
      assert.deepEqual(Object.keys(envelope).sort(), ['featureKey', 'result']);
      assert.equal(controller.present(pending.ticket, envelope), true);
      const displayed = textOf(root);
      assert.ok(
        displayed.includes(String(expectedText)),
        feature + ': verified content missing from display'
      );
      assert.ok(!displayed.includes(candidate.requestHash));
      if (auth.token) assert.ok(!displayed.includes(auth.token));

      // The same validated result cannot be delivered twice or to a new
      // scope. No additional source reads or model calls are needed.
      assert.equal(controller.present(pending.ticket, envelope), false);
      assert.equal(root.childNodes.length, 0);
      const wrong = begin();
      assert.ok(wrong);
      assert.equal(
        controller.present(wrong.ticket, {
          ...envelope,
          featureKey: 'unrelated-feature'
        }),
        false
      );
      const stale = begin();
      assert.ok(stale);
      controller.clear();
      assert.equal(controller.present(stale.ticket, envelope), false);
      const revoked = begin();
      assert.ok(revoked);
      current = false;
      assert.equal(controller.present(revoked.ticket, envelope), false);
      assert.equal(root.childNodes.length, 0);
      return envelope.result;
    }
  };
}
