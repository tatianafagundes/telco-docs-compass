# "Delete permanently" leaves a tombstone
Versions and activity events are append-only by database trigger. Permanent deletion therefore removes stored files, extracted values and access grants, clears description and characteristics, and marks the record `purged_at`; the row and its history remain and cannot be restored.
