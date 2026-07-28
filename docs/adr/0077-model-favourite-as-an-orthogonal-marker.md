# Model Favourite as an Orthogonal Marker

Favourite is a mark carried by a Photo, not a collection the Photo moves into: a Favourite Photo stays in the Timeline and appears in Favourites at the same time. This rules out the tempting shortcut of renaming the Archive membership machinery into Favourite, because that machinery moves a single denormalized projection row between collections (ADR-0038), so marking a Photo would remove it from the Timeline. Favourites instead duplicates the projection: marking writes an additional row in the `favourite` collection and increments that collection's Date Index, unmarking removes it, and the Timeline row is never touched.

Duplicating the projection rather than filtering on a marker attribute keeps Favourites inside the same collection-parameterised Browsing Window, pagination, and Viewer neighbour queries as every other view, and preserves the exact Date Index that Viewer Sequence Position depends on. A filtered query over an attribute could not supply that count cheaply, and would leave Favourites as the one view with weaker browsing behaviour than the Timeline it draws from.

## Consequences

- Every operation that moves or removes a Photo's projection -- Adjust Captured At, Revert Captured At, Delete Photo, Restore Photo, Permanent Deletion -- must maintain two rows and two Date Index counters within the same transaction when the Photo is a Favourite Photo.
- The marker ships first on its own, as a Photo attribute plus a Timeline and Viewer badge, with no Favourites view. The Favourites projection and destination follow as a separate change, which keeps the two-row consistency work isolated from the deletion work.
- Until Favourites exists, the navigation slot reserved for it stays empty rather than being filled by Trash.
