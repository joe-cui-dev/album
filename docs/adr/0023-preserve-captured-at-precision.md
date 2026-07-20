# Preserve Captured At Precision Without Invented Dates

Captured At will preserve whether the User genuinely knows a Year, Month, Day, or Date and Time. Unknown calendar components will remain absent instead of being filled with values such as January 1 or midnight; the Timeline and Photo Viewer will present only the precision that is known.

This prevents scanned and historical Photos from displaying false precision. It requires Timeline grouping and ordering to represent partial calendar values explicitly: Month-, Day-, and Date-and-Time-precision Photos can belong to a month, while Year-precision Photos belong to a Date Unknown group within that year.

Within a year, Date Unknown follows every known month so the interface does not imply that Year-precision Photos are newer than December or belong in January. Those Photos use Added At from newest to oldest only to provide a stable order inside Date Unknown; Added At is not displayed as their Captured At.

The same rule applies recursively at finer precision boundaries. Month-precision Photos follow every known day in their month, and Day-precision Photos follow every known time on their day. Photos with identical known components use Added At from newest to oldest and then Photo ID as a deterministic tie-breaker; the interface does not present either value as an invented missing calendar component.

Date-and-Time precision separately retains whether time is known to the minute, second, or subsecond. Known seconds sort before minute-only Photos within the same minute, and known subseconds sort before second-only Photos within the same second; file-modified and upload fallbacks normalize to seconds, while User adjustment may remain minute-only. This internal time resolution does not create additional Timeline groups or a fifth User-facing Captured At Precision.

All Captured At forms accept four-digit proleptic Gregorian years from `0001` through `9999`; year zero, signed or longer years, invalid month/day combinations, and automatic calendar rollover are rejected. Shared validation and ordering code will not use JavaScript `Date` for partial calendar values, removing the previous arbitrary 1900 lower bound while keeping fixed-width lexical chronology keys.
