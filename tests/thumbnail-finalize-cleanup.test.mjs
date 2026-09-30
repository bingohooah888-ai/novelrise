import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFailedThumbnailFinalize } from '../api/_lib/thumbnail-finalize-cleanup.js';

function compositionQuery(row, error = null) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return { data: row, error };
    }
  };
}

test('finalize failure removes only the current unadopted upload', async () => {
  const attemptedPath =
    'renders/42/11111111-1111-4111-8111-111111111111.png';
  const removed = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'novel_thumbnail_compositions');
      return compositionQuery({
        render_storage_path:
          'renders/42/22222222-2222-4222-8222-222222222222.webp'
      });
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'novel-thumbnail-renders');
        return {
          async remove(paths) {
            removed.push(...paths);
            return { error: null };
          }
        };
      }
    }
  };

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase,
    statusCode: 409,
    body: {
      action: 'finalize-upload',
      novelId: '42',
      path: attemptedPath
    }
  });

  assert.equal(cleaned, true);
  assert.deepEqual(removed, [attemptedPath]);
});

test('finalize cleanup never removes an adopted render', async () => {
  const attemptedPath =
    'renders/42/11111111-1111-4111-8111-111111111111.webp';
  let removeCalled = false;
  const supabase = {
    from() {
      return compositionQuery({ render_storage_path: attemptedPath });
    },
    storage: {
      from() {
        return {
          async remove() {
            removeCalled = true;
            return { error: null };
          }
        };
      }
    }
  };

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase,
    statusCode: 500,
    body: {
      action: 'finalize-upload',
      novelId: '42',
      path: attemptedPath
    }
  });

  assert.equal(cleaned, false);
  assert.equal(removeCalled, false);
});

test(
  'cleanup failure is swallowed and cannot replace the finalize result',
  async () => {
    const attemptedPath =
      'renders/42/11111111-1111-4111-8111-111111111111.png';
    const supabase = {
      from() {
        return compositionQuery({ render_storage_path: null });
      },
      storage: {
        from() {
          return {
            async remove() {
              return { error: { message: 'cleanup unavailable' } };
            }
          };
        }
      }
    };

    const cleaned = await cleanupFailedThumbnailFinalize({
      supabase,
      statusCode: 500,
      body: {
        action: 'finalize-upload',
        novelId: '42',
        path: attemptedPath
      }
    });

    assert.equal(cleaned, false);
  }
);

test('cleanup refuses paths belonging to another novel', async () => {
  let queried = false;
  const supabase = {
    from() {
      queried = true;
      throw new Error('must not query');
    }
  };

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase,
    statusCode: 409,
    body: {
      action: 'finalize-upload',
      novelId: '42',
      path: 'renders/99/11111111-1111-4111-8111-111111111111.png'
    }
  });

  assert.equal(cleaned, false);
  assert.equal(queried, false);
});
