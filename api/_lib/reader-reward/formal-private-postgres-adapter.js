// Private PostgreSQL adapter. No database package or connection is created here.
// The future OWNER-approved trusted server must inject a restricted PG query
// connection (or transaction client). Never use a browser Supabase client.
// SQL names are fixed, arguments are bound; no dynamic identifier interpolation.
const SQL_BY_FUNCTION = Object.freeze({
  award_read_points_draft:
    'select novelight_formal_private.award_read_points_draft($1::uuid,$2::timestamptz) as result',
  review_comment_and_award_draft:
    'select novelight_formal_private.review_comment_and_award_draft($1::uuid,$2::timestamptz,$3::boolean,$4::text) as result'
});

function verifiedUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

export function createFormalPrivatePostgresAdapter({ postgresClient }) {
  if (!postgresClient || typeof postgresClient.query !== 'function') {
    throw new TypeError('Trusted PostgreSQL query executor required');
  }
  return Object.freeze({
    async callPrivateFunction({ schema, functionName, params }) {
      if (
        schema !== 'novelight_formal_private' ||
        !Object.hasOwn(SQL_BY_FUNCTION, functionName)
      ) {
        return { data: null, error: { code: 'UNSUPPORTED_PRIVATE_FUNCTION' } };
      }
      const eventId =
        functionName === 'award_read_points_draft'
          ? params?.p_read_event_id
          : params?.p_comment_id;
      const release = params?.p_release_at;
      if (
        !verifiedUuid(eventId) ||
        typeof release !== 'string' ||
        !Number.isFinite(Date.parse(release))
      ) {
        return { data: null, error: { code: 'INVALID_FORMAL_EVENT' } };
      }
      const values = [eventId, release];
      if (functionName === 'review_comment_and_award_draft') {
        if (
          typeof params?.p_content_eligible !== 'boolean' ||
          typeof params?.p_reviewer_rule !== 'string' ||
          params.p_reviewer_rule.length < 1 ||
          params.p_reviewer_rule.length > 120
        ) {
          return { data: null, error: { code: 'UNVERIFIED_COMMENT_REVIEW' } };
        }
        values.push(params.p_content_eligible, params.p_reviewer_rule);
      }
      try {
        // A DB function call is one atomic statement; its transaction commits
        // the approved eligibility claim and Point ledger entry together.
        const response = await postgresClient.query(
          SQL_BY_FUNCTION[functionName],
          values
        );
        const row = response?.rows?.[0];
        if (!row || typeof row.result !== 'object' || !row.result) {
          return { data: null, error: { code: 'FORMAL_DB_RESULT_MISSING' } };
        }
        return { data: row.result, error: null };
      } catch {
        // No credential, SQL, or PII may be echoed in responses.
        return { data: null, error: { code: 'FORMAL_DB_QUERY_FAILED' } };
      }
    }
  });
}
