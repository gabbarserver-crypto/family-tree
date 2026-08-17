# FamilyTree V11 — Production, Scale & Reliability

## Goal
Prepare the FamilyTree platform for real production use on GitHub + Vercel + Supabase.

## Production areas

### Security
- Strict Supabase RLS
- Server-side privileged operations
- Secure OAuth callbacks
- OTP rate limits
- Invite-token expiration
- File upload validation
- Private Storage with signed URLs
- Abuse/rate limiting
- Security headers
- Secrets only in environment variables

### Performance
- Database indexes
- Pagination for wall/reels
- Lazy-loading family branches
- Image optimization
- Video thumbnail generation
- Cached public-safe metadata
- Avoid loading the entire family graph at once

### Reliability
- Automated database backups
- Storage backup strategy
- Error monitoring
- Audit logging
- Migration versioning
- Health checks
- Graceful failure pages

### Data integrity
- Database transactions for profile merge
- Foreign-key constraints
- Duplicate relationship prevention
- Soft-delete/redirect for merged persons
- Merge audit history
- Recovery procedure

### Deployment
GitHub
→ Vercel Preview
→ Testing
→ Vercel Production
→ Supabase Production

Use separate development and production Supabase projects where practical.

### Observability
Track:
- Auth failures
- API errors
- Database errors
- Storage failures
- Slow requests
- Moderation activity
- Merge operations
- Invite abuse

## Final production checklist
- [ ] RLS policies tested
- [ ] OAuth redirect URLs configured
- [ ] OTP provider configured
- [ ] Storage policies tested
- [ ] Merge transaction tested
- [ ] Admin roles tested
- [ ] Backup/recovery tested
- [ ] Error monitoring enabled
- [ ] Rate limits enabled
- [ ] Environment variables configured in Vercel
- [ ] Custom domain configured
- [ ] Mobile responsive QA
- [ ] Privacy policy / terms prepared
- [ ] Production smoke test completed

## Important
V11 is the production-readiness architecture. It does not claim that third-party credentials, legal documents, monitoring accounts or deployment settings are already configured.
