# FamilyTree V4 — Duplicate Detection & Merge Engine

## Goal
Safely detect duplicate people and merge their profiles without breaking the family graph.

## Duplicate detection signals
- Exact mobile number
- Exact email when available
- Same name + date of birth
- Similar name + same parent/spouse
- Same Person ID
- User/admin duplicate report

Each signal gets a confidence score. Automatic merging is NOT performed solely from a fuzzy name match.

## Duplicate workflow

1. Detect possible duplicate.
2. Show both profiles side-by-side.
3. Show matching fields and conflicting fields.
4. Show all relationships from both profiles.
5. Let authorized user/admin choose the surviving profile.
6. Select which field values to keep.
7. Combine non-conflicting information.
8. Deduplicate relationships.
9. Move posts/media/eligible records to surviving person.
10. Mark old Person ID as merged/redirected.
11. Write an immutable merge audit record.

## Profile claiming
An unclaimed profile can be claimed by the real person after OTP verification of the mobile number stored on that profile.

Claim rules:
- OTP required.
- Claim does not create a second person.
- Existing Person ID remains permanent.
- Account is linked to the existing Person.
- If another account already owns it, require secure recovery/admin workflow.

## Merge safety
Never physically destroy source data immediately.

Use:
- `merged_into_person_id`
- `merge_status`
- `merge_audit`
- `merged_at`
- `merged_by`

This allows recovery and auditing.

## Suggested tables

### duplicate_candidates
- id
- person_a_id
- person_b_id
- confidence
- reason
- status
- created_at
- reviewed_by
- reviewed_at

### merge_requests
- id
- source_person_id
- target_person_id
- requested_by
- status
- reason
- created_at
- reviewed_by
- reviewed_at

### merge_audit
- id
- source_person_id
- target_person_id
- selected_fields
- relationship_changes
- performed_by
- created_at

## Acceptance tests
1. Same mobile number creates a duplicate warning.
2. Similar names alone do not auto-merge.
3. Merge preview shows all conflicting data.
4. Relationships from both profiles survive.
5. Duplicate relationship edges are removed.
6. Old Person ID redirects to the surviving profile.
7. Merge is logged.
8. Unauthorized users cannot merge people.
9. Claimed profiles require stronger permissions for merge.
10. A failed merge leaves both profiles unchanged.
