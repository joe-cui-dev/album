import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket, EventType, HttpMethods } from "aws-cdk-lib/aws-s3";
import { SqsDestination } from "aws-cdk-lib/aws-s3-notifications";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { join } from "node:path";

export class AlbumStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const ownerEmail = this.node.tryGetContext("ownerEmail") as string;

    const photosBucket = new Bucket(this, "PhotosBucket", {
      versioned: true,
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      },
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: ["https://album.joe-cui.com", "http://localhost:5173"],
          allowedHeaders: ["*"],
          maxAge: 300
        }
      ],
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1)
        }
      ],
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const metadataTable = new Table(this, "MetadataTable", {
      partitionKey: {
        name: "pk",
        type: AttributeType.STRING
      },
      sortKey: {
        name: "sk",
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: RemovalPolicy.RETAIN
    });

    const processingDlq = new Queue(this, "PhotoProcessingDlq", {
      retentionPeriod: Duration.days(14)
    });

    const processingQueue = new Queue(this, "PhotoProcessingQueue", {
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: processingDlq,
        maxReceiveCount: 3
      }
    });

    photosBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(processingQueue),
      { prefix: "originals/" }
    );

    const commonEnvironment = {
      OWNER_EMAIL: ownerEmail,
      PHOTOS_BUCKET_NAME: photosBucket.bucketName,
      METADATA_TABLE_NAME: metadataTable.tableName
    };

    const createUploadBatch = new NodejsFunction(this, "CreateUploadBatchHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "create-upload-batch.ts"),
      handler: "handler",
      environment: commonEnvironment,
      logGroup: new LogGroup(this, "CreateUploadBatchLogGroup", {
        retention: RetentionDays.ONE_WEEK
      })
    });

    const session = new NodejsFunction(this, "SessionHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "session.ts"),
      handler: "handler",
      environment: commonEnvironment,
      logGroup: new LogGroup(this, "SessionLogGroup", {
        retention: RetentionDays.ONE_WEEK
      })
    });

    const processPhoto = new NodejsFunction(this, "ProcessPhotoHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "process-photo.ts"),
      handler: "handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 2,
      timeout: Duration.minutes(2),
      logGroup: new LogGroup(this, "ProcessPhotoLogGroup", {
        retention: RetentionDays.ONE_WEEK
      })
    });
    processPhoto.addEventSource(
      new SqsEventSource(processingQueue, {
        batchSize: 5,
        reportBatchItemFailures: true
      })
    );

    photosBucket.grantPut(createUploadBatch);
    photosBucket.grantReadWrite(processPhoto);
    metadataTable.grantReadWriteData(createUploadBatch);
    metadataTable.grantReadWriteData(processPhoto);
    processingQueue.grantConsumeMessages(processPhoto);

    const api = new HttpApi(this, "AlbumApi", {
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ["content-type"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
        allowOrigins: ["https://album.joe-cui.com", "http://localhost:5173"]
      }
    });

    api.addRoutes({
      path: "/session",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("SessionIntegration", session)
    });

    api.addRoutes({
      path: "/upload-batches",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("CreateUploadBatchIntegration", createUploadBatch)
    });
  }
}
