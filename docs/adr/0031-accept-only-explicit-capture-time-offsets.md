# Accept Only Explicit Capture Time Offsets

Capture Time Offset will be stored only when explicit source metadata pairs a valid offset with the selected capture timestamp, or when the User explicitly supplies one through Adjust Captured At. The app will not infer it from GPS coordinates, browser or server time zones, file-modified or upload instants, camera details, or filenames; an invalid offset is ignored without discarding an otherwise valid local date and time. This gives every stored offset a traceable meaning and avoids manufacturing an absolute instant from circumstantial data.
