# Keep Processing Issue Wording in the Client

The API records only a Processing Issue Reason and the Web client maps it to User-facing copy through one shared table, rather than persisting a ready-made message alongside the Photo. Storing the sentence froze presentation into DynamoDB, produced two divergent message channels for the same failure, and left the Upload Tray blank for reasons recorded without one. Unrecognised reasons fall back to a single generic message so a newer server value still renders.
