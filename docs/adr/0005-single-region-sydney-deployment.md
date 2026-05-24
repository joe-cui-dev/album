# Deploy in a Single Sydney Region

The first version will deploy to `ap-southeast-2` and will not use cross-region replication. This keeps the architecture and storage costs simple for a Personal Album primarily accessed from Australia, while relying on the durability of the regional AWS services rather than paying for multi-region disaster recovery.
