# FamilyTree V3 — Advanced Family Tree

## Goal
Turn the basic V1/V2 tree into a proper graph-based family tree.

## V3 features
- Interactive tree with pan and zoom
- Expand/collapse family branches
- Father/mother relationships
- Spouse relationships
- Children relationships
- Sibling relationships
- Maternal and paternal branches
- In-law relationships
- Relationship finder for any two people
- Relationship path display
- Search people by name or Person ID
- Focus tree on selected person
- Family branch navigation
- Responsive mobile tree view

## Relationship model
Store relationships as graph edges rather than hard-coded text. The relationship engine should derive labels from the graph.

Example:
Grandfather -> Father -> Self

The engine can derive:
- Father
- Grandfather
- Son
- Grandson
- Uncle/Aunt
- Nephew/Niece
- Cousin
- Brother/Sister
- Spouse
- In-laws

## V3 database direction
Use a normalized `relationships` table with:
- id
- tree_id
- person_a_id
- person_b_id
- relationship_type
- created_by
- status
- created_at

Keep `persons` independent from `accounts`.

## Acceptance tests
1. User sees only authorized family graph.
2. Selecting a person centers the tree on them.
3. Zoom/pan works on desktop and mobile.
4. Adding a parent updates the graph.
5. Adding a spouse/child updates both sides.
6. Relationship finder returns a path, not only a label.
7. Duplicate edges are prevented.
8. Deleted/merged persons do not leave broken relationship edges.
