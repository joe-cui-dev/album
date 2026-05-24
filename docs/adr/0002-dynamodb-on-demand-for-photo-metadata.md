# Use DynamoDB On-Demand for Photo Metadata

Photo Metadata, Timeline records, and Processing State will be stored in DynamoDB using on-demand capacity. This fits the album's low and uneven personal traffic, avoids idle database instance cost, and supports the primary access pattern of browsing photos by Captured At without introducing a heavier relational database.
