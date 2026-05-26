import { App } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { AlbumStack } from "../lib/album-stack.js";

const app = new App();

const requiredConfig = (contextName: string, envName: string): string => {
  const value =
    (app.node.tryGetContext(contextName) as string | undefined) ??
    process.env[envName];
  if (!value) {
    throw new Error(
      `Missing required config. Pass -c ${contextName}=... or set ${envName}.`,
    );
  }
  return value;
};

const certificateArn = requiredConfig("certificateArn", "CERTIFICATE_ARN");

const env = process.env.CDK_DEFAULT_ACCOUNT
  ? {
      region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2",
      account: process.env.CDK_DEFAULT_ACCOUNT,
    }
  : {
      region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2",
    };

const certificate = Certificate.fromCertificateArn(
  app,
  "AlbumCertificate",
  certificateArn,
);

new AlbumStack(app, "PersonalAlbumStack", {
  env,
  certificate,
});
