import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
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
    const webOrigins = [`https://${albumDomain}`, "http://localhost:5173"];

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

    const displayPhotosDistribution = new Distribution(
      this,
      "DisplayPhotosDistribution",
      {
        certificate: props.certificate,
        domainNames: [albumDomain],
        priceClass: PriceClass.PRICE_CLASS_100,
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(
            photosBucket as unknown as IBucket,
            {
              originPath: "/display",
            },
          ),
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      },
    );

    new ARecord(this, "AlbumAliasRecord", {
      zone: hostedZone,
      recordName: albumDomain,
      target: RecordTarget.fromAlias(
        new CloudFrontTarget(displayPhotosDistribution),
      ),
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
      { prefix: "users/" },
    );

    const commonEnvironment = {
      USER_ALLOWLIST: userAllowlist,
      PHOTOS_BUCKET_NAME: photosBucket.bucketName,
      METADATA_TABLE_NAME: metadataTable.tableName,
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
    metadataTable.grantReadWriteData(createUploadBatch);
    metadataTable.grantReadWriteData(session);
    metadataTable.grantReadWriteData(processPhoto);
    processingQueue.grantConsumeMessages(processPhoto);
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

    for (const lambda of [createUploadBatch, session, processPhoto]) {
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
