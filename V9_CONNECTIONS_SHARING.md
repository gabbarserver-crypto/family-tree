# FamilyTree V9 — Social Connections & Sharing

## Goal
Make it easy for relatives to find, invite and connect with one another without changing family membership rules.

## Features
- Share Person ID
- Share family invite link
- QR code foundation
- Invite relatives by mobile/email
- Connection suggestions
- Pending/accepted/rejected connections
- Family-tree join requests
- Optional Facebook/social profile linking
- Copy/share profile link
- Deep links to a person or family tree
- Notification when someone accepts an invitation

## Important distinction
A social connection is NOT automatically a family relationship.

Example:
Two cousins can be connected socially while the relationship graph remains the source of truth for "cousin".

## Suggested tables

### invitations
- id
- inviter_profile_id
- tree_id
- person_id
- invited_mobile
- invited_email
- token_hash
- status
- expires_at
- created_at

### social_connections
- id
- profile_a_id
- profile_b_id
- status
- created_at
- accepted_at

### tree_join_requests
- id
- tree_id
- requested_by
- status
- created_at
- reviewed_by

### shared_links
- id
- tree_id
- person_id
- created_by
- token_hash
- expires_at
- created_at

## Security
- Use random, short-lived invite tokens.
- Store token hashes, not raw permanent tokens.
- Never expose private phone/email through shared links.
- A shared Person page must obey the person's visibility settings.
- Joining a family tree requires authorization.
- Social connection does not grant access to the family tree.
- Admins do not automatically get access to every private family tree.

## Acceptance tests
1. User can share a Person ID.
2. Invite recipient can open an invite.
3. Valid invite can be accepted after authentication.
4. Expired invite is rejected.
5. Duplicate social connection is prevented.
6. Family join request requires approval when configured.
7. Private profile fields remain private.
8. Accepted social connection does not create a family relationship.
9. Notifications are generated for accepted invites.
10. User can revoke an invite.
