# Preserve Captured At Precision Without Invented Dates

Captured At will preserve whether the User genuinely knows a Year, Month, Day, or Date and Time. Unknown calendar components will remain absent instead of being filled with values such as January 1 or midnight; the Timeline and Photo Viewer will present only the precision that is known.

This prevents scanned and historical Photos from displaying false precision. It requires Timeline grouping and ordering to represent partial calendar values explicitly: Month-, Day-, and Date-and-Time-precision Photos can belong to a month, while Year-precision Photos belong to a Date Unknown group within that year.

Within a year, Date Unknown follows every known month so the interface does not imply that Year-precision Photos are newer than December or belong in January. Those Photos use Added At from newest to oldest only to provide a stable order inside Date Unknown; Added At is not displayed as their Captured At.
