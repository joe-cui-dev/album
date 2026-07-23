# Preserve Capture-Local Time for Timeline Chronology

The Timeline will order, label, and group Photos by their capture-local calendar date and time. EXIF capture times without a reliable UTC offset will remain offset-free rather than being treated as UTC or reinterpreted in the viewing browser's time zone; when a reliable offset exists, it will be preserved separately as the Capture Time Offset.

This keeps a Photo in the day and month experienced by the User when it was taken, even when the Personal Album is viewed from another time zone. It requires the stored capture-time representation and Timeline ordering keys to distinguish a local calendar value from an optional absolute-time offset, and existing values that incorrectly assumed UTC may require correction.
