import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
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
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { join } from "path";

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

    const webDistribution = new Distribution(
      this,
      "WebDistribution",
      {
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
      },
    );

    new ARecord(this, "AlbumAliasRecord", {
      zone: hostedZone,
      recordName: albumDomain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(webDistribution)),
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

    photosBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(processingQueue),
      { prefix: "originals/" },
    );

    const commonEnvironment = {
      USER_ALLOWLIST: userAllowlist,
      PHOTOS_BUCKET_NAME: photosBucket.bucketName,
      METADATA_TABLE_NAME: metadataTable.tableName,
      PROCESSING_QUEUE_URL: processingQueue.queueUrl,
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

    const archivePhoto = new NodejsFunction(this, "ArchivePhotoHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "photo-actions.ts"),
      handler: "archivePhotoHandler",
      environment: commonEnvironment,
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, "ArchivePhotoLogGroup", {
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

    const retryProcessing = new NodejsFunction(
      this,
      "RetryProcessingHandler",
      {
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

    const processPhoto = new NodejsFunction(this, "ProcessPhotoHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: join("..", "apps", "api", "src", "handlers", "process-photo.ts"),
      handler: "handler",
      environment: commonEnvironment,
      bundling: {
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

    photosBucket.grantPut(createUploadBatch);
    photosBucket.grantReadWrite(processPhoto);
    photosBucket.grantRead(displayAccessUrl);
    photosBucket.grantRead(originalDownloadUrl);
    metadataTable.grantReadWriteData(createUploadBatch);
    metadataTable.grantReadData(uploadBatchStatus);
    metadataTable.grantReadData(listTimelinePhotos);
    metadataTable.grantReadData(getPhotoDetail);
    metadataTable.grantReadWriteData(archivePhoto);
    metadataTable.grantReadData(displayAccessUrl);
    metadataTable.grantReadData(originalDownloadUrl);
    metadataTable.grantReadData(retryProcessing);
    metadataTable.grantReadWriteData(session);
    metadataTable.grantReadWriteData(processPhoto);
    processingQueue.grantConsumeMessages(processPhoto);
    processingQueue.grantSendMessages(retryProcessing);
    session.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: ["*"],
      }),
    );

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

    const processingQueueAgeAlarm = new Alarm(this, "ProcessingQueueAgeAlarm", {
      metric: processingQueue.metricApproximateAgeOfOldestMessage({
        period: Duration.minutes(5),
      }),
      threshold: Duration.minutes(15).toSeconds(),
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    processingQueueAgeAlarm.addAlarmAction(new SnsAction(alarmTopic));

    for (const lambda of [
      createUploadBatch,
      uploadBatchStatus,
      listTimelinePhotos,
      getPhotoDetail,
      archivePhoto,
      displayAccessUrl,
      originalDownloadUrl,
      retryProcessing,
      session,
      processPhoto,
    ]) {
      const errorsAlarm = new Alarm(this, `${lambda.node.id}ErrorsAlarm`, {
        metric: lambda.metricErrors({
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      errorsAlarm.addAlarmAction(new SnsAction(alarmTopic));

      const throttlesAlarm = new Alarm(
        this,
        `${lambda.node.id}ThrottlesAlarm`,
        {
          metric: lambda.metricThrottles({
            period: Duration.minutes(5),
          }),
          threshold: 0,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        },
      );
      throttlesAlarm.addAlarmAction(new SnsAction(alarmTopic));
    }

    const api = new HttpApi(this, "AlbumApi", {
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ["content-type"],
        allowMethods: [
          CorsHttpMethod.DELETE,
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
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
      path: "/photos/{photoId}/archive",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "ArchivePhotoIntegration",
        archivePhoto,
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

    new CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
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
