import { App } from "aws-cdk-lib";
import { AlbumStack } from "../lib/album-stack.js";

const app = new App();
const env = process.env.CDK_DEFAULT_ACCOUNT
  ? {
      region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2",
      account: process.env.CDK_DEFAULT_ACCOUNT
    }
  : {
      region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2"
    };

new AlbumStack(app, "PersonalAlbumStack", {
  env
});
