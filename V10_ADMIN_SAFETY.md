# FamilyTree V10 — Admin, Moderation & Safety

## Goal
Build a secure administration layer without making admins part of a user's family tree.

## Roles
### Super Admin
- Manage system administrators
- Global configuration
- Security/audit access
- Suspend accounts
- Review escalated reports

### Admin
- User/profile management
- Merge review
- Content moderation
- Family-tree support
- Connection dispute review

### Moderator
- Review posts/reels
- Handle reports
- Hide/remove violating content
- No global account/security controls

## Critical rule
Admin role and family membership are separate.

An admin viewing or moderating a record must not automatically become a member of that family tree.

## Moderation
- Report user
- Report post
- Report reel
- Report profile
- Report inappropriate media
- Review queue
- Hide content
- Restore content
- Warning/suspension
- Appeal foundation

## Audit
Record:
- Who performed action
- What changed
- Which object was affected
- Before/after metadata where appropriate
- Timestamp
- Reason

Audit records should be append-only for normal admins.

## Account safety
- Suspend user
- Unsuspend user
- Revoke sessions (server-side implementation)
- Rate limits
- Failed-login monitoring
- Abuse detection foundation

## Privacy
- Admin access must be permission-based.
- Sensitive data such as phone/email should be masked where possible.
- Production support tools should log access to private data.

## Suggested tables

### admin_roles
- id
- profile_id
- role
- granted_by
- created_at

### moderation_reports
- id
- reporter_profile_id
- target_type
- target_id
- reason
- status
- reviewed_by
- resolution
- created_at

### audit_logs
- id
- actor_profile_id
- action
- target_type
- target_id
- metadata
- created_at

### account_actions
- id
- profile_id
- action_type
- reason
- performed_by
- expires_at
- created_at

## Acceptance tests
1. Multiple admins can exist.
2. Moderator cannot grant Super Admin.
3. Admin does not automatically join family trees.
4. Reported content enters moderation queue.
5. Moderator can hide a reel/post.
6. Admin can review merge requests.
7. Every privileged action is logged.
8. Suspended users cannot perform normal social actions.
9. Private family data is not globally visible just because someone is an admin.
10. Audit entries cannot be silently edited by normal admins.
