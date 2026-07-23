import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  CfnStage,
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import {
  Bucket,
  EventType,
  HttpMethods,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import { SqsDestination } from "aws-cdk-lib/aws-s3-notifications";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { ORIGINALS_KEY_PREFIX } from "@album/shared";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export interface AlbumStackProps extends StackProps {
  certificate: ICertificate;
}

export class AlbumStack extends Stack {
  constructor(scope: Construct, id: string, props: AlbumStackProps) {
    super(scope, id, props);

    const userAllowlist = requiredConfig(
      this,
      "userAllowlist",
      "USER_ALLOWLIST",
    );
    const albumDomain = requiredConfig(this, "albumDomain", "ALBUM_DOMAIN");
    const hostedZoneId = requiredConfig(this, "hostedZoneId", "HOSTED_ZONE_ID");
    const hostedZoneDomain = requiredConfig(
      this,
      "hostedZoneDomain",
      "HOSTED_ZONE_DOMAIN",
    );
    const sessionSigningSecret = requiredConfig(
      this,
      "sessionSigningSecret",
      "SESSION_SIGNING_SECRET",
    );
    const sesFromEmail = optionalConfig(this, "sesFromEmail", "SES_FROM_EMAIL");
    const allowDevAuthCodes =
      optionalConfig(this, "allowDevAuthCodes", "ALLOW_DEV_AUTH_CODES") ??
      "false";
    const monthlyBudgetUsd = Number(
      this.node.tryGetContext("monthlyBudgetUsd") ?? "10",
    );
    const budgetAlertEmail =
      optionalConfig(this, "budgetAlertEmail", "BUDGET_ALERT_EMAIL") ??
      firstAllowlistedEmail(userAllowlist);
    const webOrigins = [
      `https://${albumDomain}`,
      ...csvConfig(this, "additionalWebOrigins", "ADDITIONAL_WEB_ORIGINS"),
    ];

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      hostedZoneId,
      zoneName: hostedZoneDomain,
    });

    const photosBucket = new Bucket(this, "PhotosBucket", {
      versioned: true,
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: webOrigins,
          allowedHeaders: ["*"],
          maxAge: 300,
        },
      ],
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const webBucket = new Bucket(this, "WebAssetsBucket", {
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const webDistribution = new Distribution(this, "WebDistribution", {
      certificate: props.certificate,
      domainNames: [albumDomain],
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
      ],
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(
          webBucket as unknown as IBucket,
        ),
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    new ARecord(this, "AlbumAliasRecord", {
      zone: hostedZone,
      recordName: albumDomain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(webDistribution)),
    });

    new BucketDeployment(this, "WebAssetsDeployment", {
      sources: [
        Source.asset(join(currentDir, "..", "..", "..", "apps", "web", "dist")),
      ],
      destinationBucket: webBucket as unknown as IBucket,
      distribution: webDistribution,
      distributionPaths: ["/*"],
      prune: true,
      memoryLimit: 512,
    });

    const metadataTable = new Table(this, "MetadataTable", {
      partitionKey: {
        name: "pk",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const processingDlq = new Queue(this, "PhotoProcessingDlq", {
      retentionPeriod: Duration.days(14),
    });

    const processingQueue = new Queue(this, "PhotoProcessingQueue", {
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: processingDlq,
        maxReceiveCount: 3,
      },
    });

    const photoMaintenanceDlq = new Queue(this, "PhotoMaintenanceDlq", {
      retentionPeriod: Duration.days(14),
    });
    const photoMaintenanceQueue = new Queue(this, "PhotoMaintenanceQueue", {
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: photoMaintenanceDlq,
        maxReceiveCount: 3,
      },
    });

    photosBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(processingQueue),
      { prefix: ORIGINALS_KEY_PREFIX },
    );

    // Auth v2's asynchronous dispatch queue (execution plan Slice 1.4 / ADR-0071): the
    // admission handler only ever enqueues a request identity + Email, never a Code, and
    // the allowlist check happens solely in the worker below.
    const signInDispatchDlq = new Queue(this, "SignInDispatchDlq", {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
    });
    const signInDispatchQueue = new Queue(this, "SignInDispatchQueue", {
      visibilityTimeout: Duration.minutes(1),
      encryption: QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: signInDispatchDlq,
        maxReceiveCount: 3,
      },
    });

    const commonEnvironment = {
      USER_ALLOWLIST: userAllowlist,
      WEB_ORIGINS: webOrigins.join(","),
      SIGN_IN_DISPATCH_QUEUE_URL: signInDispatchQueue.queueUrl,
      PHOTOS_BUCKET_NAME: photosBucket.bucketName,
      METADATA_TABLE_NAME: metadataTable.tableName,
      PROCESSING_QUEUE_URL: processingQueue.queueUrl,
      PHOTO_MAINTENANCE_QUEUE_URL: photoMaintenanceQueue.queueUrl,
      SESSION_SIGNING_SECRET: sessionSigningSecret,
      ALLOW_DEV_AUTH_CODES: allowDevAuthCodes,
      ...(sesFromEmail ? { SES_FROM_EMAIL: sesFromEmail } : {}),
    };

    const createUploadBatch = new NodejsFunction(
      this,
      "CreateUploadBatchHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "create-upload-batch.ts",
        ),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "CreateUploadBatchLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const uploadBatchStatus = new NodejsFunction(
      this,
      "UploadBatchStatusHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "upload-batch-status.ts",
        ),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "UploadBatchStatusLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const listTimelinePhotos = new NodejsFunction(
      this,
      "ListTimelinePhotosHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "list-timeline-photos.ts",
        ),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "ListTimelinePhotosLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const getPhotoDetail = new NodejsFunction(this, "GetPhotoDetailHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "photo-actions.ts"),
      handler: "getPhotoDetailHandler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "GetPhotoDetailLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const displayAccessUrl = new NodejsFunction(
      this,
      "DisplayAccessUrlHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join("..", "apps", "api", "src", "handlers", "photo-actions.ts"),
        handler: "displayAccessUrlHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "DisplayAccessUrlLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const originalDownloadUrl = new NodejsFunction(
      this,
      "OriginalDownloadUrlHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join("..", "apps", "api", "src", "handlers", "photo-actions.ts"),
        handler: "originalDownloadUrlHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "OriginalDownloadUrlLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const retryProcessing = new NodejsFunction(this, "RetryProcessingHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join(
        "..",
        "apps",
        "api",
        "src",
        "handlers",
        "retry-processing.ts",
      ),
      handler: "handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "RetryProcessingLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const processingIssues = new NodejsFunction(
      this,
      "ProcessingIssuesHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "processing-issues.ts",
        ),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "ProcessingIssuesLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const processingIssuesSummary = new NodejsFunction(
      this,
      "ProcessingIssuesSummaryHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "processing-issues.ts",
        ),
        handler: "summaryHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "ProcessingIssuesSummaryLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const timelinePhotosV2 = new NodejsFunction(
      this,
      "TimelinePhotosV2Handler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "list-collection-photos-v2.ts",
        ),
        handler: "timelinePhotosV2Handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "TimelinePhotosV2LogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const archivePhotosV2 = new NodejsFunction(this, "ArchivePhotosV2Handler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join(
        "..",
        "apps",
        "api",
        "src",
        "handlers",
        "list-collection-photos-v2.ts",
      ),
      handler: "archivePhotosV2Handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "ArchivePhotosV2LogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const albumNavigation = new NodejsFunction(this, "AlbumNavigationHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join(
        "..",
        "apps",
        "api",
        "src",
        "handlers",
        "album-navigation.ts",
      ),
      handler: "handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "AlbumNavigationLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const timelineThumbnailAccess = new NodejsFunction(
      this,
      "TimelineThumbnailAccessHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "timeline-thumbnail-access.ts",
        ),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "TimelineThumbnailAccessLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const viewerBootstrap = new NodejsFunction(this, "ViewerBootstrapHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join(
        "..",
        "apps",
        "api",
        "src",
        "handlers",
        "viewer-bootstrap.ts",
      ),
      handler: "handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "ViewerBootstrapLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const adjustCapturedAt = new NodejsFunction(
      this,
      "AdjustCapturedAtHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "captured-at-adjustment.ts",
        ),
        handler: "adjustCapturedAtHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "AdjustCapturedAtLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const revertCapturedAt = new NodejsFunction(
      this,
      "RevertCapturedAtHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "captured-at-adjustment.ts",
        ),
        handler: "revertCapturedAtHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "RevertCapturedAtLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const archiveMembership = new NodejsFunction(
      this,
      "ArchiveMembershipHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "archive-membership.ts",
        ),
        handler: "archiveMembershipHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "ArchiveMembershipLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const restoreMembership = new NodejsFunction(
      this,
      "RestoreMembershipHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "archive-membership.ts",
        ),
        handler: "restoreMembershipHandler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 5,
        logGroup: new LogGroup(this, "RestoreMembershipLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const session = new NodejsFunction(this, "SessionHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "session.ts"),
      handler: "handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "SessionLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const sessionV2 = new NodejsFunction(this, "SessionV2Handler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "session-v2.ts"),
      handler: "handler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "SessionV2LogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const dispatchSignInCode = new NodejsFunction(
      this,
      "DispatchSignInCodeHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join(
          "..",
          "apps",
          "api",
          "src",
          "handlers",
          "dispatch-sign-in-code.ts",
        ),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 2,
        timeout: Duration.seconds(30),
        logGroup: new LogGroup(this, "DispatchSignInCodeLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );
    dispatchSignInCode.addEventSource(
      new SqsEventSource(signInDispatchQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    const processPhoto = new NodejsFunction(this, "ProcessPhotoHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "process-photo.ts"),
      handler: "handler",
      environment: commonEnvironment,
      bundling: {
        forceDockerBundling: true,
        nodeModules: ["sharp"],
      },
      reservedConcurrentExecutions: 2,
      timeout: Duration.minutes(2),
      logGroup: new LogGroup(this, "ProcessPhotoLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      }),
    });
    processPhoto.addEventSource(
      new SqsEventSource(processingQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    const photoMaintenanceWorker = new NodejsFunction(
      this,
      "PhotoMaintenanceWorker",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join("..", "apps", "api", "src", "maintenance.ts"),
        handler: "maintenanceWorkerHandler",
        environment: commonEnvironment,
        bundling: { forceDockerBundling: true, nodeModules: ["sharp"] },
        reservedConcurrentExecutions: 2,
        timeout: Duration.minutes(2),
        logGroup: new LogGroup(this, "PhotoMaintenanceWorkerLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );
    photoMaintenanceWorker.addEventSource(
      new SqsEventSource(photoMaintenanceQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    const photoMaintenanceCoordinator = new NodejsFunction(
      this,
      "PhotoMaintenanceCoordinator",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join("..", "apps", "api", "src", "maintenance-coordinator.ts"),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 1,
        timeout: Duration.minutes(5),
        logGroup: new LogGroup(this, "PhotoMaintenanceCoordinatorLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    const phase2Reconciliation = new NodejsFunction(
      this,
      "Phase2Reconciliation",
      {
        runtime: Runtime.NODEJS_22_X,
        entry: join("..", "apps", "api", "src", "reconciliation-handler.ts"),
        handler: "handler",
        environment: commonEnvironment,
        reservedConcurrentExecutions: 1,
        timeout: Duration.minutes(5),
        logGroup: new LogGroup(this, "Phase2ReconciliationLogGroup", {
          retention: RetentionDays.ONE_WEEK,
        }),
      },
    );

    photosBucket.grantPut(createUploadBatch);
    photosBucket.grantReadWrite(processPhoto);
    photosBucket.grantRead(listTimelinePhotos);
    photosBucket.grantRead(displayAccessUrl);
    photosBucket.grantRead(originalDownloadUrl);
    photosBucket.grantRead(viewerBootstrap);
    photosBucket.grantRead(timelinePhotosV2);
    photosBucket.grantRead(archivePhotosV2);
    photosBucket.grantRead(timelineThumbnailAccess);
    metadataTable.grantReadWriteData(createUploadBatch);
    metadataTable.grantReadData(uploadBatchStatus);
    metadataTable.grantReadData(listTimelinePhotos);
    metadataTable.grantReadData(getPhotoDetail);
    metadataTable.grantReadData(displayAccessUrl);
    metadataTable.grantReadData(originalDownloadUrl);
    metadataTable.grantReadData(viewerBootstrap);
    metadataTable.grantReadData(retryProcessing);
    metadataTable.grantReadData(processingIssues);
    metadataTable.grantReadData(processingIssuesSummary);
    metadataTable.grantReadData(timelinePhotosV2);
    metadataTable.grantReadData(archivePhotosV2);
    metadataTable.grantReadData(albumNavigation);
    metadataTable.grantReadData(timelineThumbnailAccess);
    metadataTable.grantReadWriteData(adjustCapturedAt);
    metadataTable.grantReadWriteData(revertCapturedAt);
    metadataTable.grantReadWriteData(archiveMembership);
    metadataTable.grantReadWriteData(restoreMembership);
    metadataTable.grantReadWriteData(session);
    metadataTable.grantReadWriteData(processPhoto);
    metadataTable.grantReadWriteData(photoMaintenanceWorker);
    metadataTable.grantReadWriteData(photoMaintenanceCoordinator);
    metadataTable.grantReadWriteData(phase2Reconciliation);
    photosBucket.grantRead(phase2Reconciliation);
    processingQueue.grantConsumeMessages(processPhoto);
    processingQueue.grantSendMessages(retryProcessing);
    photoMaintenanceQueue.grantConsumeMessages(photoMaintenanceWorker);
    photoMaintenanceQueue.grantSendMessages(photoMaintenanceCoordinator);
    photosBucket.grantReadWrite(photoMaintenanceWorker);
    session.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: ["*"],
      }),
    );
    dispatchSignInCode.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: ["*"],
      }),
    );
    metadataTable.grantReadWriteData(sessionV2);
    metadataTable.grantReadWriteData(dispatchSignInCode);
    // Least privilege: the admission handler only ever sends; the worker only ever consumes.
    signInDispatchQueue.grantSendMessages(sessionV2);
    signInDispatchQueue.grantConsumeMessages(dispatchSignInCode);

    const alarmTopic = new Topic(this, "AlarmTopic");
    alarmTopic.addSubscription(new EmailSubscription(budgetAlertEmail));

    new CfnBudget(this, "MonthlyCostBudget", {
      budget: {
        budgetName: "personal-album-monthly-cost",
        budgetLimit: {
          amount: monthlyBudgetUsd,
          unit: "USD",
        },
        budgetType: "COST",
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              address: budgetAlertEmail,
              subscriptionType: "EMAIL",
            },
          ],
        },
      ],
    });

    const dlqVisibleMessagesAlarm = new Alarm(
      this,
      "ProcessingDlqVisibleMessagesAlarm",
      {
        metric: processingDlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    dlqVisibleMessagesAlarm.addAlarmAction(new SnsAction(alarmTopic));

    const maintenanceDlqVisibleMessagesAlarm = new Alarm(
      this,
      "PhotoMaintenanceDlqVisibleMessagesAlarm",
      {
        metric: photoMaintenanceDlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    maintenanceDlqVisibleMessagesAlarm.addAlarmAction(
      new SnsAction(alarmTopic),
    );

    const signInDispatchDlqVisibleMessagesAlarm = new Alarm(
      this,
      "SignInDispatchDlqVisibleMessagesAlarm",
      {
        metric: signInDispatchDlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    signInDispatchDlqVisibleMessagesAlarm.addAlarmAction(
      new SnsAction(alarmTopic),
    );

    const api = new HttpApi(this, "AlbumApi", {
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ["content-type"],
        allowMethods: [
          CorsHttpMethod.DELETE,
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
        ],
        allowOrigins: webOrigins,
      },
    });

    api.addRoutes({
      path: "/session",
      methods: [HttpMethod.GET, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("SessionIntegration", session),
    });

    api.addRoutes({
      path: "/session/sign-in-code",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("SessionCodeIntegration", session),
    });

    api.addRoutes({
      path: "/session/verify",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "SessionVerifyIntegration",
        session,
      ),
    });

    const sessionV2CodeRoutes = api.addRoutes({
      path: "/v2/session/sign-in-code",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "SessionV2CodeIntegration",
        sessionV2,
      ),
    });

    const sessionV2VerifyRoutes = api.addRoutes({
      path: "/v2/session/verify",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "SessionV2VerifyIntegration",
        sessionV2,
      ),
    });

    // Per-route throttles for the two public, unauthenticated auth v2 endpoints (execution
    // plan Slice 1.4: request ~1/s burst 5, verify ~5/s burst 10). The L2 HttpApi construct
    // has no per-route throttle API, so this reaches the default stage's L1 escape hatch.
    // This assignment overwrites the whole map -- if a later route needs its own throttle,
    // add its key here rather than setting `.routeSettings` again elsewhere.
    const defaultStage = api.defaultStage!.node.defaultChild as CfnStage;
    defaultStage.routeSettings = {
      "POST /v2/session/sign-in-code": {
        ThrottlingRateLimit: 1,
        ThrottlingBurstLimit: 5,
      },
      "POST /v2/session/verify": {
        ThrottlingRateLimit: 5,
        ThrottlingBurstLimit: 10,
      },
    };
    // RouteSettings refers to route keys, but CloudFormation does not infer an
    // ordering relationship from those JSON keys. Ensure the routes exist before
    // it applies the Default Stage settings that reference them.
    api.defaultStage!.node.addDependency(
      ...sessionV2CodeRoutes,
      ...sessionV2VerifyRoutes,
    );

    api.addRoutes({
      path: "/upload-batches",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "CreateUploadBatchIntegration",
        createUploadBatch,
      ),
    });

    api.addRoutes({
      path: "/upload-batches/{uploadBatchId}",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "UploadBatchStatusIntegration",
        uploadBatchStatus,
      ),
    });

    api.addRoutes({
      path: "/timeline",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "ListTimelinePhotosIntegration",
        listTimelinePhotos,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "GetPhotoDetailIntegration",
        getPhotoDetail,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/display-access",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "DisplayAccessUrlIntegration",
        displayAccessUrl,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/original-download",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "OriginalDownloadUrlIntegration",
        originalDownloadUrl,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/retry-processing",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "RetryProcessingIntegration",
        retryProcessing,
      ),
    });

    api.addRoutes({
      path: "/processing-issues",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "ProcessingIssuesIntegration",
        processingIssues,
      ),
    });

    api.addRoutes({
      path: "/processing-issues/summary",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "ProcessingIssuesSummaryIntegration",
        processingIssuesSummary,
      ),
    });

    api.addRoutes({
      path: "/v2/timeline",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "TimelinePhotosV2Integration",
        timelinePhotosV2,
      ),
    });

    api.addRoutes({
      path: "/v2/archive",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "ArchivePhotosV2Integration",
        archivePhotosV2,
      ),
    });

    api.addRoutes({
      path: "/album-navigation",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "AlbumNavigationIntegration",
        albumNavigation,
      ),
    });

    api.addRoutes({
      path: "/timeline-thumbnail-access",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "TimelineThumbnailAccessIntegration",
        timelineThumbnailAccess,
      ),
    });

    api.addRoutes({
      path: "/v2/photos/{photoId}/viewer",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "ViewerBootstrapIntegration",
        viewerBootstrap,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/captured-at-adjustment",
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration(
        "AdjustCapturedAtIntegration",
        adjustCapturedAt,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/captured-at-adjustment",
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration(
        "RevertCapturedAtIntegration",
        revertCapturedAt,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/archive",
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration(
        "ArchiveMembershipIntegration",
        archiveMembership,
      ),
    });

    api.addRoutes({
      path: "/photos/{photoId}/archive",
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration(
        "RestoreMembershipIntegration",
        restoreMembership,
      ),
    });

    new CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
    });

    new CfnOutput(this, "PhotoMaintenanceCoordinatorName", {
      value: photoMaintenanceCoordinator.functionName,
    });
    new CfnOutput(this, "Phase2ReconciliationName", {
      value: phase2Reconciliation.functionName,
    });

    new CfnOutput(this, "WebAssetsBucketName", {
      value: webBucket.bucketName,
    });

    new CfnOutput(this, "WebDistributionId", {
      value: webDistribution.distributionId,
    });

    new CfnOutput(this, "WebDistributionDomainName", {
      value: webDistribution.distributionDomainName,
    });
  }
}

// Try to get the value from context first, then fallback to environment variable. Throw an error if neither is set.
const requiredConfig = (
  stack: Stack,
  contextName: string,
  envName: string,
): string => {
  const value = optionalConfig(stack, contextName, envName);
  if (!value) {
    throw new Error(
      `Missing required config. Pass -c ${contextName}=... or set ${envName}.`,
    );
  }
  return value;
};

const optionalConfig = (
  stack: Stack,
  contextName: string,
  envName: string,
): string | undefined => {
  return (
    (stack.node.tryGetContext(contextName) as string | undefined) ??
    process.env[envName]
  );
};

const csvConfig = (
  stack: Stack,
  contextName: string,
  envName: string,
): string[] => {
  const value = optionalConfig(stack, contextName, envName);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const firstAllowlistedEmail = (userAllowlist: string): string => {
  const firstEntry = userAllowlist.split(",")[0];
  const email = firstEntry?.split(":")[1];
  if (!email) {
    throw new Error(
      "USER_ALLOWLIST must include at least one userId:email entry.",
    );
  }
  return email;
};
