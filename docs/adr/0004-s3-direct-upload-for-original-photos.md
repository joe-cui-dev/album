# Upload Original Photos Directly to S3

Original Photos will be uploaded directly from the browser to private S3 objects using short-lived presigned upload URLs. API Gateway and Lambda will handle the control plane for creating Upload Batches and issuing upload authorization, while the photo bytes bypass the API so large files and batch uploads do not consume Lambda execution time or API Gateway payload capacity.
