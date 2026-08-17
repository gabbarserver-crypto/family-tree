# FamilyTree V5 — Profiles, Photos & Media

## Goal
Create complete family-person profiles and a privacy-first media layer.

## Person profile
Each person can have:
- Profile photo
- Full name
- Display name
- Date of birth
- Gender
- Mobile number (private)
- Email (private)
- Biography/about
- Father
- Mother
- Spouse(s)
- Children
- Siblings
- Family branches
- Important dates

## Media
- Profile photos
- Family photos
- Albums
- Video attachments (foundation)
- Captions
- Upload date
- Uploaded by
- Tagged people

## Privacy
Every profile/media item should support:
- Private
- Family only
- Selected family
- Public (optional, disabled by default)

Private mobile/email must never be exposed by a public profile.

## Storage
Recommended:
- Supabase Storage buckets
- Database metadata in Postgres
- Signed URLs for private media
- File type and size validation
- Upload authorization
- Delete/restore policy

## Person tagging
A photo can tag multiple Person IDs. Tags should create no relationship automatically.

## Profile ownership
ACCOUNT and PERSON remain separate.
A person can be:
- unclaimed
- claimed
- merged/redirected

## Acceptance tests
1. User can edit their authorized profile.
2. User can upload a profile photo.
3. User can create an album.
4. User can upload photos to an album.
5. Family-only media is inaccessible to unauthorized users.
6. Mobile/email are private.
7. Merging two people does not orphan media.
8. Deleted media is removed from public access.
9. Image sizes/types are validated.
10. Every upload has an owner and timestamp.
