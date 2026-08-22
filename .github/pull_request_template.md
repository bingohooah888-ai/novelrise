## Summary

<!-- What changed and why? -->

## Scope

- [ ] UI / frontend
- [ ] API / backend
- [ ] Database / Supabase / RLS
- [ ] Authentication / authorization
- [ ] Stripe / billing
- [ ] GitHub Actions / CI
- [ ] Documentation / configuration only

## Verification

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Playwright browser smoke tests (when browser-facing behavior is relevant)
- [ ] RLS integration tests (when relevant)
- [ ] Vercel Preview checked (when deploy-relevant)
- [ ] Manual behavior check (when relevant)

## Security & data safety

- [ ] No secrets or credentials were committed
- [ ] Dependency vulnerability audit passed when dependencies changed
- [ ] CodeQL impact was reviewed for security-sensitive changes
- [ ] Authorization / RLS impact was reviewed when relevant
- [ ] Billing impact was reviewed when relevant
- [ ] Data migration / rollback impact was reviewed when relevant
- [ ] Independent second-model review completed for high-risk changes when practical

## Risk / rollback

<!-- What could break, and how can this change be reverted safely? -->

## Notes

<!-- Anything the reviewer or future maintainer should know. -->
